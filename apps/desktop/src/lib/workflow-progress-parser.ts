/**
 * Parser for extracting structured progress information from console output
 */

export interface ProgressInfo {
  currentStep?: number;
  totalSteps?: number;
  currentAction?: string;
  percentage?: number;
  state?: string;
  isComplete?: boolean;
  error?: string;
  lastLogLines?: string[];
}

export interface ConsoleLogEntry {
  timestamp: number;
  message: string;
  level: "log" | "error" | "warn" | "info";
}

/**
 * Parse console output to extract progress information
 */
export function parseProgressFromConsole(logs: ConsoleLogEntry[]): ProgressInfo {
  const info: ProgressInfo = {
    lastLogLines: [],
  };

  // Keep last 5 meaningful log lines
  const meaningfulLogs = logs
    .filter(log => log.message && log.message.trim().length > 0)
    .slice(-5)
    .map(log => log.message);

  info.lastLogLines = meaningfulLogs;

  // Parse the logs for progress patterns
  for (const log of logs) {
    const message = log.message;

    // Check for step indicators (Step 1:, Step 2:, etc.)
    const stepMatch = message.match(/Step\s+(\d+)(?:\s*(?:of|\/)\s*(\d+))?:/i);
    if (stepMatch) {
      info.currentStep = parseInt(stepMatch[1]);
      if (stepMatch[2]) {
        info.totalSteps = parseInt(stepMatch[2]);
      }
    }

    // Check for percentage indicators
    const percentMatch = message.match(/(\d+)%/);
    if (percentMatch) {
      info.percentage = parseInt(percentMatch[1]);
    }

    // Check for state transitions (common patterns in SAP workflow)
    if (message.includes("Starting") || message.includes("Initializing")) {
      info.state = "initializing";
    } else if (message.includes("Navigating") || message.includes("Opening")) {
      info.state = "navigating";
    } else if (message.includes("Login") || message.includes("Authenticating")) {
      info.state = "authenticating";
    } else if (message.includes("Filling") || message.includes("Entering")) {
      info.state = "filling_data";
    } else if (message.includes("Processing entry")) {
      const entryMatch = message.match(/Processing entry\s+(\d+)\/(\d+)/);
      if (entryMatch) {
        info.currentStep = parseInt(entryMatch[1]);
        info.totalSteps = parseInt(entryMatch[2]);
        info.state = "processing_entries";
      }
    } else if (message.includes("Completed") || message.includes("Finished")) {
      info.isComplete = true;
      info.state = "completed";
    } else if (message.includes("Failed") || message.includes("Error")) {
      info.state = "error";
      if (log.level === "error") {
        info.error = message;
      }
    }

    // Extract current action from emoji patterns
    const emojiPatterns = [
      { pattern: /🚀\s+(.+)/, type: "starting" },
      { pattern: /📍\s+(.+)/, type: "navigation" },
      { pattern: /🔍\s+(.+)/, type: "searching" },
      { pattern: /✅\s+(.+)/, type: "completed" },
      { pattern: /📊\s+(.+)/, type: "processing" },
      { pattern: /🔐\s+(.+)/, type: "authentication" },
      { pattern: /📝\s+(.+)/, type: "data_entry" },
      { pattern: /⚠️\s+(.+)/, type: "warning" },
      { pattern: /❌\s+(.+)/, type: "error" },
      { pattern: /💡\s+(.+)/, type: "info" },
      { pattern: /🎯\s+(.+)/, type: "action" },
      { pattern: /🔄\s+(.+)/, type: "retry" },
      { pattern: /🏁\s+(.+)/, type: "finish" },
    ];

    for (const { pattern } of emojiPatterns) {
      const match = message.match(pattern);
      if (match) {
        info.currentAction = match[1].trim();
        break;
      }
    }

    // Parse structured log patterns like [Domain Login], [Page Detection], etc.
    const structuredMatch = message.match(/\[([^\]]+)\]\s+(.+)/);
    if (structuredMatch) {
      const [, context, action] = structuredMatch;
      info.currentAction = `${context}: ${action}`;
    }
  }

  // Calculate percentage if we have step info but no explicit percentage
  if (!info.percentage && info.currentStep && info.totalSteps) {
    info.percentage = Math.round((info.currentStep / info.totalSteps) * 100);
  }

  return info;
}

/**
 * Format console output for display
 */
export function formatConsoleOutput(logs: ConsoleLogEntry[], maxLines: number = 10): string[] {
  return logs.slice(-maxLines).map(log => {
    const time = new Date(log.timestamp).toLocaleTimeString("en-US", {
      hour12: false,
      timeStyle: "medium",
    });

    // Add color/style indicators based on log level
    const prefix =
      {
        error: "❌",
        warn: "⚠️",
        info: "ℹ️",
        log: "",
      }[log.level] || "";

    return `${prefix} ${log.message}`.trim();
  });
}
