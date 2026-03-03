#!/usr/bin/env node
/**
 * Migrate in-memory chat history to AWS IVS Chat
 *
 * Usage: node scripts/migrate-chat-to-ivs.js [options]
 *
 * Options:
 *   --dry-run          Show what would be migrated without sending to IVS
 *   --channel <name>   Migrate specific channel (default: all channels)
 *   --limit <n>        Migrate only last N messages per channel (default: 100)
 *
 * Prerequisites:
 * - IVS_CHAT_ROOM_ARN environment variable must be set
 * - AWS credentials configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
 * - WebSocket Gateway running with populated LRU cache
 * - REDIS_ENDPOINT and REDIS_PORT environment variables set
 *
 * Example:
 *   # Dry run to see what would be migrated
 *   node scripts/migrate-chat-to-ivs.js --dry-run
 *
 *   # Migrate specific channel
 *   node scripts/migrate-chat-to-ivs.js --channel lobby
 *
 *   # Migrate all channels, limit to last 50 messages each
 *   node scripts/migrate-chat-to-ivs.js --limit 50
 */

const { IvschatClient, SendMessageCommand } = require('@aws-sdk/client-ivschat');
const Redis = require('ioredis');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    channel: null,
    limit: 100
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--channel':
        options.channel = args[++i];
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--help':
        console.log(`
Usage: node scripts/migrate-chat-to-ivs.js [options]

Options:
  --dry-run          Show what would be migrated without sending to IVS
  --channel <name>   Migrate specific channel (default: all channels)
  --limit <n>        Migrate only last N messages per channel (default: 100)
  --help             Show this help message

Prerequisites:
  - IVS_CHAT_ROOM_ARN environment variable must be set
  - AWS credentials configured
  - WebSocket Gateway running with populated LRU cache
  - REDIS_ENDPOINT and REDIS_PORT environment variables set
        `);
        process.exit(0);
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  return options;
}

// Validate environment variables
function validateEnvironment() {
  const required = ['IVS_CHAT_ROOM_ARN', 'REDIS_ENDPOINT'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Error: Missing required environment variables: ${missing.join(', ')}`);
    console.error('\nSet them before running migration:');
    console.error('  export IVS_CHAT_ROOM_ARN="arn:aws:ivschat:us-east-1:123456789012:room/..."');
    console.error('  export REDIS_ENDPOINT="your-redis-endpoint.cache.amazonaws.com"');
    process.exit(1);
  }

  return {
    roomArn: process.env.IVS_CHAT_ROOM_ARN,
    redisEndpoint: process.env.REDIS_ENDPOINT,
    redisPort: process.env.REDIS_PORT || '6379',
    awsRegion: process.env.AWS_REGION || 'us-east-1'
  };
}

/**
 * Extract messages from Redis-backed LRU cache
 *
 * Note: This implementation assumes the ChatService stores messages in a Redis hash
 * for each channel. If your implementation stores messages differently, adjust this logic.
 *
 * @param {Redis} redis - Redis client
 * @param {string} channel - Channel name
 * @param {number} limit - Maximum messages to extract
 * @returns {Promise<Array>} Array of message objects
 */
async function extractChannelMessages(redis, channel, limit) {
  try {
    // ChatService stores messages in channelCaches Map (in-memory LRU)
    // This is NOT in Redis by default - it's in the Node.js process memory
    // To migrate, we need to query the running gateway's internal state
    //
    // For this migration script to work, we have two approaches:
    // 1. Query a management API endpoint on the gateway that exports LRU cache state
    // 2. Temporarily persist LRU cache to Redis during migration window
    //
    // For now, we'll implement approach #2: expect operator to export cache to Redis
    // using a temporary Redis key pattern: `chat:migration:{channel}`

    const migrationKey = `chat:migration:${channel}`;
    const messageIds = await redis.lrange(migrationKey, 0, -1);

    if (messageIds.length === 0) {
      return [];
    }

    const messages = [];
    for (const msgId of messageIds.slice(-limit)) {
      const msgData = await redis.get(`chat:migration:msg:${msgId}`);
      if (msgData) {
        messages.push(JSON.parse(msgData));
      }
    }

    return messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch (error) {
    console.error(`Error extracting messages for channel ${channel}:`, error.message);
    return [];
  }
}

/**
 * Get all channels that have migration data
 *
 * @param {Redis} redis - Redis client
 * @returns {Promise<Array<string>>} Array of channel names
 */
async function getChannelsWithMigrationData(redis) {
  try {
    const keys = await redis.keys('chat:migration:*');
    const channels = keys
      .filter(key => !key.includes(':msg:')) // Exclude message keys
      .map(key => key.replace('chat:migration:', ''));
    return channels;
  } catch (error) {
    console.error('Error getting channels:', error.message);
    return [];
  }
}

/**
 * Migrate messages for a single channel to IVS Chat
 *
 * @param {IvschatClient} ivsClient - IVS Chat client
 * @param {string} roomArn - IVS Chat room ARN
 * @param {string} channel - Channel name
 * @param {Array} messages - Messages to migrate
 * @param {boolean} dryRun - If true, don't send to IVS
 * @returns {Promise<Object>} Migration result stats
 */
async function migrateChannelHistory(ivsClient, roomArn, channel, messages, dryRun) {
  const stats = {
    channel,
    total: messages.length,
    succeeded: 0,
    failed: 0,
    errors: []
  };

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Migrating channel: ${channel}`);
  console.log(`  Messages to migrate: ${messages.length}`);

  for (const msg of messages) {
    try {
      if (dryRun) {
        console.log(`  [DRY RUN] Would send message ${msg.id}:`, {
          content: msg.message.substring(0, 50) + (msg.message.length > 50 ? '...' : ''),
          timestamp: msg.timestamp,
          clientId: msg.clientId
        });
        stats.succeeded++;
      } else {
        const command = new SendMessageCommand({
          roomIdentifier: roomArn,
          content: msg.message,
          attributes: {
            channel: channel,
            clientId: msg.clientId,
            originalTimestamp: msg.timestamp, // Preserve original timestamp
            migratedFrom: 'lru-cache'
          }
        });

        await ivsClient.send(command);
        stats.succeeded++;

        // Log progress every 10 messages
        if (stats.succeeded % 10 === 0) {
          console.log(`  Progress: ${stats.succeeded}/${messages.length} messages sent`);
        }
      }

      // Rate limit: IVS has 10 messages/second limit by default
      // Add small delay to avoid throttling
      await new Promise(resolve => setTimeout(resolve, 150)); // ~6.6 msg/sec, safe margin
    } catch (error) {
      stats.failed++;
      stats.errors.push({
        messageId: msg.id,
        error: error.message
      });

      console.error(`  Failed to send message ${msg.id}:`, error.message);

      // If we hit throttling, back off more aggressively
      if (error.name === 'ThrottlingException') {
        console.log('  Throttling detected, slowing down...');
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }
  }

  console.log(`  ${dryRun ? '[DRY RUN] ' : ''}Completed: ${stats.succeeded} succeeded, ${stats.failed} failed`);
  return stats;
}

/**
 * Main migration function
 */
async function main() {
  const options = parseArgs();
  const env = validateEnvironment();

  console.log('=== IVS Chat Migration Tool ===');
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE MIGRATION'}`);
  console.log(`IVS Room: ${env.roomArn}`);
  console.log(`Redis: ${env.redisEndpoint}:${env.redisPort}`);
  console.log(`Channel filter: ${options.channel || 'all channels'}`);
  console.log(`Message limit per channel: ${options.limit}`);
  console.log();

  if (!options.dryRun) {
    console.log('WARNING: This will send messages to IVS Chat and incur costs.');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Initialize clients
  const redis = new Redis({
    host: env.redisEndpoint,
    port: parseInt(env.redisPort, 10),
    retryStrategy: () => null, // Don't retry on connection failure
    lazyConnect: true
  });

  const ivsClient = new IvschatClient({ region: env.awsRegion });

  try {
    // Connect to Redis
    console.log('Connecting to Redis...');
    await redis.connect();
    console.log('Connected to Redis');

    // Get channels to migrate
    let channels = [];
    if (options.channel) {
      channels = [options.channel];
    } else {
      channels = await getChannelsWithMigrationData(redis);
      if (channels.length === 0) {
        console.log('\nNo migration data found in Redis.');
        console.log('\nTo export LRU cache for migration:');
        console.log('1. Add an export endpoint to your WebSocket Gateway');
        console.log('2. Or manually populate Redis with keys: chat:migration:{channel}');
        console.log('\nSee .planning/phases/05-enhanced-reliability-optional/IVS-DEPLOYMENT.md for details.');
        process.exit(0);
      }
    }

    console.log(`\nFound ${channels.length} channel(s) to migrate`);

    // Migrate each channel
    const allStats = [];
    for (const channel of channels) {
      const messages = await extractChannelMessages(redis, channel, options.limit);

      if (messages.length === 0) {
        console.log(`\nChannel ${channel}: No messages found, skipping`);
        continue;
      }

      const stats = await migrateChannelHistory(
        ivsClient,
        env.roomArn,
        channel,
        messages,
        options.dryRun
      );
      allStats.push(stats);
    }

    // Print summary
    console.log('\n=== Migration Summary ===');
    const totalMessages = allStats.reduce((sum, s) => sum + s.total, 0);
    const totalSucceeded = allStats.reduce((sum, s) => sum + s.succeeded, 0);
    const totalFailed = allStats.reduce((sum, s) => sum + s.failed, 0);

    console.log(`Channels processed: ${allStats.length}`);
    console.log(`Total messages: ${totalMessages}`);
    console.log(`Succeeded: ${totalSucceeded}`);
    console.log(`Failed: ${totalFailed}`);

    if (totalFailed > 0) {
      console.log('\nErrors encountered:');
      allStats.forEach(stats => {
        if (stats.errors.length > 0) {
          console.log(`  Channel ${stats.channel}:`);
          stats.errors.forEach(err => {
            console.log(`    Message ${err.messageId}: ${err.error}`);
          });
        }
      });
    }

    if (options.dryRun) {
      console.log('\n[DRY RUN] No messages were actually sent to IVS.');
      console.log('Run without --dry-run to perform live migration.');
    } else {
      console.log('\nMigration complete!');
      console.log('\nNext steps:');
      console.log('1. Verify messages in IVS Chat via AWS Console or ListMessages API');
      console.log('2. Clean up migration data from Redis: redis-cli --scan --pattern "chat:migration:*" | xargs redis-cli del');
      console.log('3. Update Fargate task with IVS_CHAT_ROOM_ARN to enable IVS Chat feature');
    }

  } catch (error) {
    console.error('\nMigration failed:', error);
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('\nUncaught error:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('\nUnhandled promise rejection:', error);
  process.exit(1);
});

// Run migration
main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
