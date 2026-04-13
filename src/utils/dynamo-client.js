// src/utils/dynamo-client.js
//
// Shared DynamoDB client factory. Creates a single client configured for
// the current environment (production AWS or local DynamoDB/LocalStack).

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

/**
 * Create a DynamoDB client configured from environment variables.
 *
 * - Production: uses default AWS credentials and AWS_REGION
 * - Local dev: uses LOCALSTACK_ENDPOINT or DYNAMODB_ENDPOINT with dummy credentials
 *
 * @returns {DynamoDBClient}
 */
function createDynamoClient() {
    const opts = { region: process.env.AWS_REGION || 'us-east-1' };

    const endpoint = process.env.LOCALSTACK_ENDPOINT || process.env.DYNAMODB_ENDPOINT;
    if (endpoint) {
        opts.endpoint = endpoint;
        opts.credentials = {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
        };
    }

    return new DynamoDBClient(opts);
}

module.exports = { createDynamoClient };
