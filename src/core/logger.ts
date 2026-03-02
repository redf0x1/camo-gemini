export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL = (() => {
  const level = process.env.CAMOGEMINI_LOG_LEVEL?.toUpperCase();
  switch (level) {
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
})();

function log(level: LogLevel, label: string, message: string, data?: Record<string, unknown>): void {
  if (level < LOG_LEVEL) return;
  const timestamp = new Date().toISOString();
  const levelName = LogLevel[level];
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  process.stderr.write(`[${timestamp}] [${levelName}] [${label}] ${message}${dataStr}\n`);
}

export const logger = {
  debug: (label: string, msg: string, data?: Record<string, unknown>) => log(LogLevel.DEBUG, label, msg, data),
  info: (label: string, msg: string, data?: Record<string, unknown>) => log(LogLevel.INFO, label, msg, data),
  warn: (label: string, msg: string, data?: Record<string, unknown>) => log(LogLevel.WARN, label, msg, data),
  error: (label: string, msg: string, data?: Record<string, unknown>) => log(LogLevel.ERROR, label, msg, data),
};
