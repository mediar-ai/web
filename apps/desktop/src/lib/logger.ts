/**
 * Structured logging utility for MCP operations.
 */

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

interface LogContext {
  component?: string;
  [key: string]: any;
}

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  context?: LogContext;
  metadata?: Record<string, any>;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

class Logger {
  private context: LogContext = {};
  private isDevelopment = import.meta.env.DEV;
  private minLevel: LogLevel = this.isDevelopment ? LogLevel.DEBUG : LogLevel.INFO;

  /**
   * Create a new logger instance with additional context
   */
  withContext(ctx: LogContext): Logger {
    const childLogger = new Logger();
    childLogger.context = { ...this.context, ...ctx };
    childLogger.minLevel = this.minLevel;
    childLogger.isDevelopment = this.isDevelopment;
    return childLogger;
  }

  private log(entry: LogEntry): void {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentLevelIndex = levels.indexOf(this.minLevel);
    const entryLevelIndex = levels.indexOf(entry.level);

    if (entryLevelIndex < currentLevelIndex) {
      return;
    }

    if (this.isDevelopment) {
      this.logDevelopment(entry);
    } else {
      this.logProduction(entry);
    }
  }

  private logDevelopment(entry: LogEntry): void {
    const icons = {
      [LogLevel.DEBUG]: "🐛",
      [LogLevel.INFO]: "ℹ️",
      [LogLevel.WARN]: "⚠️",
      [LogLevel.ERROR]: "❌",
    };

    const icon = icons[entry.level];
    const component = entry.context?.component || this.context.component;
    const componentStr = component ? `[${component}]` : "";
    const message = `${icon} ${componentStr} ${entry.message}`;
    const args: any[] = [message];

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      args.push("\n  Metadata:", entry.metadata);
    }

    const fullContext = { ...this.context, ...entry.context };
    if (Object.keys(fullContext).length > 0) {
      args.push("\n  Context:", fullContext);
    }

    if (entry.error) {
      args.push("\n  Error:", entry.error.message);
      if (entry.error.stack) {
        args.push("\n  Stack:", entry.error.stack);
      }
    }

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(...args);
        break;
      case LogLevel.INFO:
        console.log(...args);
        break;
      case LogLevel.WARN:
        console.warn(...args);
        break;
      case LogLevel.ERROR:
        console.error(...args);
        break;
    }
  }

  private logProduction(entry: LogEntry): void {
    const logEntry = {
      ...entry,
      context: { ...this.context, ...entry.context },
    };

    const json = JSON.stringify(logEntry);

    switch (entry.level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        console.log(json);
        break;
      case LogLevel.WARN:
        console.warn(json);
        break;
      case LogLevel.ERROR:
        console.error(json);
        break;
    }
  }

  debug(message: string, metadata?: Record<string, any>): void {
    this.log({
      level: LogLevel.DEBUG,
      timestamp: new Date().toISOString(),
      message,
      context: this.context,
      metadata,
    });
  }

  info(message: string, metadata?: Record<string, any>): void {
    this.log({
      level: LogLevel.INFO,
      timestamp: new Date().toISOString(),
      message,
      context: this.context,
      metadata,
    });
  }

  warn(message: string, metadata?: Record<string, any>): void {
    this.log({
      level: LogLevel.WARN,
      timestamp: new Date().toISOString(),
      message,
      context: this.context,
      metadata,
    });
  }

  error(message: string, error?: Error | unknown, metadata?: Record<string, any>): void {
    const errorInfo =
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          }
        : error
          ? { message: String(error) }
          : undefined;

    this.log({
      level: LogLevel.ERROR,
      timestamp: new Date().toISOString(),
      message,
      context: this.context,
      metadata,
      error: errorInfo,
    });
  }
}

// MCP-specific logger (only export used by the codebase)
export const mcpLogger = new Logger().withContext({ component: "MCP" });
