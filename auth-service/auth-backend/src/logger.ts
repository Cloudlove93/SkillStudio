import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

export function getLogger(name: string) {
  return pino({
    name,
    level,
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : {
            target: 'pino-pretty',
            options: { colorize: true },
          },
  });
}
