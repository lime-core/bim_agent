type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, data?: unknown): void {
  const prefix = `[${timestamp()}] [${level}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export const logger = {
  info: (msg: string, data?: unknown) => log('INFO', msg, data),
  warn: (msg: string, data?: unknown) => log('WARN', msg, data),
  error: (msg: string, data?: unknown) => log('ERROR', msg, data),
  debug: (msg: string, data?: unknown) => {
    if (process.env.DEBUG) log('DEBUG', msg, data);
  },
};
