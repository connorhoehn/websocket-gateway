// middleware/auth-middleware.js

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { ErrorCodes } = require('../utils/error-codes');
const { JWKS_CACHE_MAX_AGE_MS, JWKS_REQUESTS_PER_MINUTE } = require('../config/constants');

/**
 * Custom error class for authentication failures
 */
class AuthError extends Error {
    constructor(code, statusCode, message) {
        super(message);
        this.name = 'AuthError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

/**
 * Authentication middleware for WebSocket connections
 * Validates Cognito JWT tokens on WebSocket upgrade
 */
class AuthMiddleware {
    constructor(logger) {
        this.logger = logger;

        // Validate required environment variables
        const region = process.env.COGNITO_REGION;
        const userPoolId = process.env.COGNITO_USER_POOL_ID;

        if (!region || !userPoolId) {
            throw new Error('Missing required environment variables: COGNITO_REGION and COGNITO_USER_POOL_ID must be set');
        }

        this.region = region;
        this.userPoolId = userPoolId;
        this.issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

        // Initialize JWKS client with caching
        this.jwksClient = jwksClient({
            jwksUri: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
            cache: true,
            cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
            rateLimit: true,
            jwksRequestsPerMinute: JWKS_REQUESTS_PER_MINUTE
        });

        this.logger.info(`AuthMiddleware initialized for region: ${region}, userPoolId: ${userPoolId}`);
    }

    /**
     * Get signing key from JWKS
     */
    async getSigningKey(kid) {
        try {
            const key = await this.jwksClient.getSigningKey(kid);
            return key.getPublicKey();
        } catch (error) {
            this.logger.error('Failed to fetch signing key:', error);
            throw new AuthError(ErrorCodes.AUTH_FAILED, 401, 'Authentication failed');
        }
    }

    /**
     * Validate JWT token from WebSocket connection request
     * @param {http.IncomingMessage} req - HTTP upgrade request
     * @returns {Object} User context extracted from token
     */
    async validateToken(req) {
        // Local dev bypass — skip Cognito validation entirely
        if (process.env.SKIP_AUTH === 'true') {
            const url = new URL(req.url, 'http://localhost');
            const userId = url.searchParams.get('userId') || `dev-user-${Math.random().toString(36).slice(2, 8)}`;
            this.logger.info(`[SKIP_AUTH] Accepting connection for user: ${userId}`);
            return {
                userId,
                email: `${userId}@local.dev`,
                channels: [],
                isAdmin: true
            };
        }

        try {
            // Prefer JWT from Sec-WebSocket-Protocol subprotocol header.
            // Format: "bearer-token-v1, <jwt>" — marker first, token second.
            // Fall back to query param for old clients (deprecated).
            let token;
            let tokenSource = 'subprotocol';

            const protocolHeader = req.headers['sec-websocket-protocol'];
            if (protocolHeader) {
                const protocols = protocolHeader.split(',').map((p) => p.trim());
                const markerIdx = protocols.indexOf('bearer-token-v1');
                if (markerIdx !== -1 && protocols.length > markerIdx + 1) {
                    token = protocols[markerIdx + 1];
                }
            }

            if (!token) {
                const url = new URL(req.url, 'http://localhost');
                const queryToken = url.searchParams.get('token');
                if (queryToken) {
                    this.logger.warn(
                        'JWT received via query parameter (deprecated — exposes token in logs/proxies). Update client to use Sec-WebSocket-Protocol header.'
                    );
                    token = queryToken;
                    tokenSource = 'query';
                }
            }

            if (!token) {
                this.logger.warn('Connection attempt without token');
                throw new AuthError(ErrorCodes.AUTH_TOKEN_MISSING, 401, 'Authentication required');
            }

            // Decode token to get header (without verification)
            let decoded;
            try {
                decoded = jwt.decode(token, { complete: true });
            } catch (error) {
                this.logger.error('Token decode error:', error);
                throw new AuthError(ErrorCodes.AUTH_FAILED, 401, 'Authentication failed');
            }

            if (!decoded || !decoded.header || !decoded.header.kid) {
                this.logger.warn('Invalid token structure - missing kid');
                throw new AuthError(ErrorCodes.AUTH_FAILED, 401, 'Authentication failed');
            }

            // Get signing key
            const publicKey = await this.getSigningKey(decoded.header.kid);

            // Verify token with public key
            let verified;
            try {
                verified = jwt.verify(token, publicKey, {
                    algorithms: ['RS256'],
                    issuer: this.issuer
                });
            } catch (error) {
                this.logger.error('Token verification failed:', {
                    error: error.message,
                    name: error.name
                });

                // Provide more specific error for expired tokens
                if (error.name === 'TokenExpiredError') {
                    throw new AuthError(ErrorCodes.AUTH_TOKEN_EXPIRED, 401, 'Token expired');
                }

                throw new AuthError(ErrorCodes.AUTH_FAILED, 401, 'Authentication failed');
            }

            // Extract user context from claims
            const givenName = verified.given_name || verified['custom:given_name'] || '';
            const familyName = verified.family_name || verified['custom:family_name'] || '';
            const displayName = [givenName, familyName].filter(Boolean).join(' ') || verified.email || null;

            const userContext = {
                userId: verified.sub,
                email: verified.email || null,
                displayName,
                channels: verified.channels || [],
                isAdmin: verified.isAdmin || false
            };

            this.logger.info(`Token validated for user: ${userContext.userId} (source: ${tokenSource})`);

            return userContext;

        } catch (error) {
            // If it's already an AuthError, re-throw it
            if (error instanceof AuthError) {
                throw error;
            }

            // Log unexpected errors with full details
            this.logger.error('Unexpected authentication error:', {
                error: error.message,
                stack: error.stack
            });

            // Return generic auth failure to client
            throw new AuthError('AUTH_FAILED', 401, 'Authentication failed');
        }
    }
}

module.exports = AuthMiddleware;
module.exports.AuthError = AuthError;
