import { pino, type Logger } from 'pino';
import { loadEnv } from '@float/config';

const env = loadEnv();

export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'agent-service' },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }
    : {}),
});

export type { Logger };
