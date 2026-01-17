/**
 * Generate inline hint for tool call display
 * Returns a short summary like "src/foo.ts:1-50" or "5 files matched"
 */
export function getToolInlineHint(toolName: string, args: any, result?: any): string | null {
  try {
    switch (toolName) {
      // File operations
      case "read_file": {
        const path = args?.path || "";
        const filename = path.split(/[/\\]/).pop() || path;
        if (args?.offset || args?.limit) {
          return `${filename}:${args.offset || 1}-${(args.offset || 1) + (args.limit || 100)}`;
        }
        return filename;
      }

      case "edit_file": {
        const editPath = args?.path || "";
        return editPath.split(/[/\\]/).pop() || editPath;
      }

      case "write_file": {
        const writePath = args?.path || "";
        return writePath.split(/[/\\]/).pop() || writePath;
      }

      case "glob_files": {
        const pattern = args?.pattern || "";
        const globCount = Array.isArray(result?.content)
          ? result.content.length
          : typeof result === "string"
            ? result.split("\n").filter(Boolean).length
            : null;
        return globCount !== null ? `${pattern} → ${globCount} files` : pattern;
      }

      case "grep_files": {
        const grepPattern = args?.pattern || "";
        const truncPattern = grepPattern.length > 20 ? grepPattern.slice(0, 17) + "..." : grepPattern;
        return `"${truncPattern}"`;
      }

      // Execute sequence
      case "execute_sequence": {
        if (args?.url) {
          const url = args.url;
          const wfFilename = url.split(/[/\\]/).pop()?.replace("file://", "") || url;
          // Check result for step count
          const steps = result?.steps_executed || result?.total_steps;
          return steps ? `${wfFilename} (${steps} steps)` : wfFilename;
        }
        if (args?.steps?.length) {
          return `${args.steps.length} inline steps`;
        }
        return null;
      }

      // UI automation
      case "click_element": {
        if (args?.selector) {
          const sel = args.selector;
          // Extract name from selector like "role:Button && name:Save"
          const nameMatch = sel.match(/name:([^|]+)/);
          return nameMatch ? nameMatch[1].slice(0, 20) : sel.slice(0, 25);
        }
        return null;
      }

      case "type_into_element": {
        const text = args?.text_to_type || "";
        const truncText = text.length > 15 ? text.slice(0, 12) + "..." : text;
        return `"${truncText}"`;
      }

      case "navigate_browser": {
        const navUrl = args?.url || "";
        try {
          const hostname = new URL(navUrl).hostname;
          return hostname;
        } catch {
          return navUrl.slice(0, 30);
        }
      }

      case "get_window_tree":
        return args?.process || null;

      case "run_command":
        if (args?.engine) {
          return args.engine;
        }
        if (args?.run) {
          const cmd = args.run;
          return cmd.length > 25 ? cmd.slice(0, 22) + "..." : cmd;
        }
        return null;

      case "capture_screenshot":
        return args?.process || null;

      case "press_key":
      case "press_key_global":
        return args?.key || null;

      case "scroll_element":
        return args?.direction || null;

      case "open_application":
        return args?.app_name || null;

      case "execute_browser_script":
        return args?.process || "browser";

      default:
        return null;
    }
  } catch {
    return null;
  }
}
