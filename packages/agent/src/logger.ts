import { pino, type Logger } from 'pino';
import { config } from './config.js';

export const logger: Logger = pino({
  level: config.logLevel,
  transport: process.stdout.isTTY
    ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
    : undefined,
});

/** Per-deal child logger — every log line for a deal carries its correlation id. */
export function dealLogger(dealId: string): Logger {
  return logger.child({ dealId });
}
