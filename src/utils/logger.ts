import chalk from 'chalk';

export enum LogLevel {
  Silent = 0,
  Error = 1,
  Warn = 2,
  Info = 3,
  Debug = 4,
}

let currentLevel = LogLevel.Info;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function setVerbose(verbose: boolean): void {
  currentLevel = verbose ? LogLevel.Debug : LogLevel.Info;
}

function log(level: LogLevel, prefix: string, color: (s: string) => string, message: string, ...args: unknown[]): void {
  if (currentLevel < level) return;
  const formatted = args.length > 0 ? `${message} ${args.map(String).join(' ')}` : message;
  console.error(color(`${prefix} ${formatted}`));
}

export const logger = {
  error(message: string, ...args: unknown[]): void {
    log(LogLevel.Error, '[ERROR]', chalk.red, message, ...args);
  },
  warn(message: string, ...args: unknown[]): void {
    log(LogLevel.Warn, '[WARN]', chalk.yellow, message, ...args);
  },
  info(message: string, ...args: unknown[]): void {
    log(LogLevel.Info, '[INFO]', chalk.blue, message, ...args);
  },
  debug(message: string, ...args: unknown[]): void {
    log(LogLevel.Debug, '[DEBUG]', chalk.gray, message, ...args);
  },
  scan(message: string, ...args: unknown[]): void {
    log(LogLevel.Info, '[SCAN]', chalk.cyan, message, ...args);
  },
  parse(message: string, ...args: unknown[]): void {
    log(LogLevel.Debug, '[PARSE]', chalk.magenta, message, ...args);
  },
  probe(message: string, ...args: unknown[]): void {
    log(LogLevel.Debug, '[PROBE]', chalk.magenta, message, ...args);
  },
  tmdb(message: string, ...args: unknown[]): void {
    log(LogLevel.Debug, '[TMDB]', chalk.green, message, ...args);
  },
  batch(message: string, ...args: unknown[]): void {
    log(LogLevel.Debug, '[BATCH]', chalk.blueBright, message, ...args);
  },
  rename(message: string, ...args: unknown[]): void {
    log(LogLevel.Info, '[RENAME]', chalk.yellow, message, ...args);
  },
};
