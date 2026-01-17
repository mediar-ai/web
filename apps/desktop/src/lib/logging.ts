import {
  debug as logDebug,
  error as logError,
  info as logInfo,
  trace as logTrace,
  warn as logWarn
} from '@tauri-apps/plugin-log';

/**
 * Unified logging utility for the Mediar app
 * Sends both frontend and backend logs to the same unified log file
 */
export class Logger {
  private static isConsoleAttached = false;
  private static ipcErrorCount = 0;
  private static lastIpcError: string | null = null;
  private static originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    debug: console.debug,
    info: console.info
  };

  /**
   * Initialize the logger and override console methods to capture logs
   * This ensures all console.log/error/warn/debug calls are captured to log files
   * while still showing in the browser console
   */
  static async init() {
    if (!this.isConsoleAttached) {

      try {
        // Override console methods to intercept and forward to log files
        this.overrideConsoleMethods();
        this.isConsoleAttached = true;

        // Log initialization status using original console to avoid recursion during init
        const initMessage = import.meta.env.DEV 
          ? '📝 [Logger] Console methods overridden for unified logging - development mode'
          : '📝 [Logger] Console methods overridden for unified logging - production mode';
        
        this.originalConsole.log(initMessage);
        this.originalConsole.log('📁 [Logger] All console output will be captured to log files AND shown in browser console');
        
        // Also send to log file
        await logInfo(initMessage);
      } catch (err) {
        this.originalConsole.warn('Failed to initialize unified logging:', err);
        // Still log that we're initialized even if override failed
        await Logger.info('Logger', 'Frontend logging initialized (console override failed)');
      }
    }
  }

  /**
   * Handle IPC errors with detailed logging
   */
  private static handleIpcError(err: any, logLevel: string, message: string) {
    this.ipcErrorCount++;
    const errorDetails = err instanceof Error
      ? `${err.name}: ${err.message}\nStack: ${err.stack}`
      : String(err);

    this.lastIpcError = `[${logLevel}] ${errorDetails}`;

    // Log to original console on first few errors so we can see what's happening
    if (this.ipcErrorCount <= 5) {
      this.originalConsole.error(
        `❌ [Logger] IPC call #${this.ipcErrorCount} failed for ${logLevel}:`,
        errorDetails,
        '\nMessage that failed:', message.substring(0, 100)
      );
    } else if (this.ipcErrorCount === 6) {
      this.originalConsole.error(
        `❌ [Logger] IPC errors continue (${this.ipcErrorCount} total). Suppressing further error logs.`
      );
    }
  }

  /**
   * Override global console methods to capture and forward logs
   */
  private static overrideConsoleMethods() {
    // Override console.log
    console.log = (...args: any[]) => {
      const message = this.formatConsoleArgs(args);
      this.originalConsole.log(...args); // Show in browser console
      logInfo(`[Console] ${message}`).catch((err) => this.handleIpcError(err, 'INFO', message));
    };

    // Override console.error
    console.error = (...args: any[]) => {
      const message = this.formatConsoleArgs(args);

      // Filter out known Mastra client-js bugs
      if (
        message.includes('stepResult') ||
        message.includes('Cannot close a locked stream') ||
        (message.includes('JSON parse error') && message.includes('stepResult'))
      ) {
        // Suppress known bugs - they don't affect functionality
        return;
      }

      this.originalConsole.error(...args); // Show in browser console
      logError(`[Console] ${message}`).catch((err) => this.handleIpcError(err, 'ERROR', message));
    };

    // Override console.warn
    console.warn = (...args: any[]) => {
      const message = this.formatConsoleArgs(args);
      this.originalConsole.warn(...args); // Show in browser console
      logWarn(`[Console] ${message}`).catch((err) => this.handleIpcError(err, 'WARN', message));
    };

    // Override console.debug
    console.debug = (...args: any[]) => {
      const message = this.formatConsoleArgs(args);
      this.originalConsole.debug(...args); // Show in browser console
      logDebug(`[Console] ${message}`).catch((err) => this.handleIpcError(err, 'DEBUG', message));
    };

    // Override console.info
    console.info = (...args: any[]) => {
      const message = this.formatConsoleArgs(args);
      this.originalConsole.info(...args); // Show in browser console
      logInfo(`[Console] ${message}`).catch((err) => this.handleIpcError(err, 'INFO', message));
    };
  }

  /**
   * Get diagnostic information about IPC errors
   */
  static getDiagnostics() {
    return {
      isConsoleAttached: this.isConsoleAttached,
      ipcErrorCount: this.ipcErrorCount,
      lastIpcError: this.lastIpcError,
      isDev: import.meta.env.DEV,
      isProd: import.meta.env.PROD,
    };
  }

  /**
   * Format console arguments into a single string
   */
  private static formatConsoleArgs(args: any[]): string {
    return args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  }

  /**
   * Log an info message
   */
  static async info(component: string, message: string, data?: any) {
    const logMessage = this.formatMessage(component, message, data);
    try {
      await logInfo(logMessage);
    } catch (err) {
      console.info(logMessage); // Fallback to console
    }
  }

  /**
   * Log an error message
   */
  static async error(component: string, message: string, error?: any) {
    const logMessage = this.formatMessage(component, message, error);
    try {
      await logError(logMessage);
    } catch (err) {
      console.error(logMessage); // Fallback to console
    }
  }

  /**
   * Log a debug message
   */
  static async debug(component: string, message: string, data?: any) {
    const logMessage = this.formatMessage(component, message, data);
    try {
      await logDebug(logMessage);
    } catch (err) {
      console.debug(logMessage); // Fallback to console
    }
  }

  /**
   * Log a warning message
   */
  static async warn(component: string, message: string, data?: any) {
    const logMessage = this.formatMessage(component, message, data);
    try {
      await logWarn(logMessage);
    } catch (err) {
      console.warn(logMessage); // Fallback to console
    }
  }

  /**
   * Log a trace message
   */
  static async trace(component: string, message: string, data?: any) {
    const logMessage = this.formatMessage(component, message, data);
    try {
      await logTrace(logMessage);
    } catch (err) {
      console.debug(logMessage); // Fallback to console
    }
  }

  /**
   * Format log message with component and optional data
   */
  private static formatMessage(component: string, message: string, data?: any): string {
    let formatted = `[Frontend:${component}] ${message}`;

    if (data !== undefined) {
      if (data instanceof Error) {
        formatted += ` | Error: ${data.message}`;
        if (data.stack) {
          formatted += ` | Stack: ${data.stack}`;
        }
      } else if (typeof data === 'object') {
        try {
          formatted += ` | Data: ${JSON.stringify(data)}`;
        } catch {
          formatted += ` | Data: [object]`;
        }
      } else {
        formatted += ` | Data: ${String(data)}`;
      }
    }

    return formatted;
  }
}

// Export convenience functions for direct use
export const logger = Logger;

// Export individual functions for compatibility
export { Logger as default };
