/**
 * Structured JSON logger (pino) for the websocket-gateway service.
 *
 * Usage:
 *   const log = require('./structured-logger');
 *   const reqLog = log.withContext({ correlationId, userId });
 *   reqLog.info({ action: 'trigger.create' }, 'pipeline triggered');
 *
 * Configuration:
 *   - WSG_SERVICE_NAME (default: 'gateway')
 *   - LOG_LEVEL        (default: 'info')
 *   - NODE_ENV=development uses pino-pretty if available, else plain JSON.
 */

const pino = require('pino');

const serviceName = process.env.WSG_SERVICE_NAME || 'gateway';
const level = process.env.LOG_LEVEL || 'info';
const isDev = process.env.NODE_ENV === 'development';

const baseOptions = {
  level,
  base: { service: serviceName },
  timestamp: pino.stdTimeFunctions.isoTime,
};

let logger;

if (isDev) {
  let prettyTransport;
  try {
    // try-require pino-pretty; if not installed, fall back to plain JSON.
    require.resolve('pino-pretty');
    prettyTransport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  } catch (_) {
    prettyTransport = undefined;
  }
  logger = prettyTransport
    ? pino({ ...baseOptions, transport: prettyTransport })
    : pino(baseOptions);
} else {
  logger = pino(baseOptions);
}

/**
 * Returns a child logger with the given fields bound to every log line.
 * Handy for per-request loggers carrying correlationId, runId, userId, etc.
 *
 * @param {Record<string, unknown>} ctx
 * @returns {import('pino').Logger}
 */
logger.withContext = function withContext(ctx) {
  return logger.child(ctx);
};

module.exports = logger;
