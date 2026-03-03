const redis = require('redis');

/**
 * Lambda Message Review Handler for AWS IVS Chat
 *
 * Invoked by IVS Chat for every message before delivery.
 *
 * Responsibilities:
 * 1. Content moderation - check for profanity/spam
 * 2. Return ALLOW or DENY to IVS Chat
 * 3. Publish approved messages to Redis pub/sub for WebSocket delivery
 * 4. Fail-open - allow messages if errors occur (resilience over strict moderation)
 *
 * Flow:
 * 1. Client sends message to IVS Chat room
 * 2. IVS invokes this Lambda before delivery
 * 3. Lambda checks content for banned keywords
 * 4. If clean: publish to Redis websocket:route:{channel}, return ALLOW
 * 5. If profane: return DENY with reason
 * 6. If error: log and return ALLOW (fail-open)
 *
 * Redis pub/sub channel pattern: websocket:route:{channel}
 * Message format: { type: 'chat', action: 'message', message: {...} }
 */

// Simple profanity check (expand as needed)
const BANNED_KEYWORDS = ['spam', 'profanity-example']; // Add actual keywords in production

let redisClient = null;

/**
 * Get or create Redis client (singleton pattern for Lambda container reuse)
 * @returns {Promise<RedisClient>}
 */
async function getRedisClient() {
  if (!redisClient) {
    redisClient = redis.createClient({
      socket: {
        host: process.env.REDIS_ENDPOINT,
        port: parseInt(process.env.REDIS_PORT || '6379')
      }
    });

    await redisClient.connect();
  }
  return redisClient;
}

/**
 * Check if content contains banned keywords
 * @param {string} content - Message content
 * @returns {boolean} true if profanity detected
 */
function checkForProfanity(content) {
  const lowerContent = content.toLowerCase();
  return BANNED_KEYWORDS.some(keyword => lowerContent.includes(keyword));
}

/**
 * Lambda handler for IVS Chat message review
 * @param {Object} event - IVS Chat review event
 * @param {string} event.Content - Message content
 * @param {string} event.MessageId - Message ID
 * @param {Object} event.Sender - Sender info
 * @param {string} event.Sender.UserId - Sender user ID
 * @param {string} event.RoomArn - IVS Chat room ARN
 * @param {Object} event.Attributes - Message attributes (channel, clientId)
 * @returns {Promise<Object>} Review result { ReviewResult: 'ALLOW'|'DENY', Content, Attributes }
 */
exports.handler = async (event) => {
  console.log('Message review event:', JSON.stringify(event));

  const { Content, MessageId, Sender, RoomArn, Attributes } = event;

  try {
    // Moderation check
    if (checkForProfanity(Content)) {
      console.log(`Message ${MessageId} denied for profanity`);
      return {
        ReviewResult: 'DENY',
        Content: Content,
        Attributes: {
          ...Attributes,
          Reason: 'Message contains inappropriate content'
        }
      };
    }

    // Message approved - forward to WebSocket clients via Redis pub/sub
    const channel = Attributes?.channel || 'general';
    const redisChannel = `websocket:route:${channel}`;

    const message = {
      type: 'chat',
      action: 'message',
      message: {
        id: MessageId,
        clientId: Attributes?.clientId || Sender.UserId,
        message: Content,
        timestamp: new Date().toISOString()
      }
    };

    const client = await getRedisClient();
    await client.publish(redisChannel, JSON.stringify(message));

    console.log(`Message ${MessageId} approved and forwarded to ${redisChannel}`);

    return {
      ReviewResult: 'ALLOW',
      Content: Content,
      Attributes: Attributes
    };

  } catch (error) {
    console.error('Error in message review handler:', error);

    // Fail-open: allow message if error occurs
    // Better to allow potentially inappropriate content than block legitimate messages
    return {
      ReviewResult: 'ALLOW',
      Content: Content,
      Attributes: Attributes
    };
  }
};
