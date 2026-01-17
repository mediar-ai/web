/**
 * Extensible workflow linting rules system
 *
 * Add new rules by implementing the LintRule interface and registering in defaultRules.
 */

export type LintSeverity = "error" | "warning" | "info" | "hint";

export interface LintFix {
  /** Label shown on the fix button */
  label: string;
  /** Replacement text for the matched range */
  replacement: string;
}

export interface LintAction {
  /** Label shown on the action button */
  label: string;
  /** Type of action */
  type: "replace" | "ask-ai";
  /** For "replace" type: replacement text */
  replacement?: string;
  /** For "ask-ai" type: prompt to send to chat */
  prompt?: string;
}

export interface LintResult {
  /** Start position in document (0-indexed) */
  from: number;
  /** End position in document (0-indexed) */
  to: number;
  /** Human-readable message */
  message: string;
  /** Severity level */
  severity: LintSeverity;
  /** Optional quick fix (legacy, use actions instead) */
  fix?: LintFix;
  /** Multiple actions available for this issue */
  actions?: LintAction[];
  /** Rule ID for filtering/configuration */
  ruleId: string;
}

export interface LintRule {
  /** Unique rule identifier */
  id: string;
  /** Human-readable rule name */
  name: string;
  /** Default severity (can be overridden by config) */
  defaultSeverity: LintSeverity;
  /** Rule description for documentation */
  description: string;
  /** Check function - analyzes code and returns issues */
  check: (code: string) => LintResult[];
}

export interface LinterConfig {
  /** Rules to enable (by ID). If empty, all rules are enabled */
  enabledRules?: string[];
  /** Rules to disable (by ID) */
  disabledRules?: string[];
  /** Override severity for specific rules */
  severityOverrides?: Record<string, LintSeverity>;
}

/**
 * Registry of all available lint rules
 */
class RuleRegistry {
  private rules: Map<string, LintRule> = new Map();

  register(rule: LintRule): void {
    this.rules.set(rule.id, rule);
  }

  get(id: string): LintRule | undefined {
    return this.rules.get(id);
  }

  getAll(): LintRule[] {
    return Array.from(this.rules.values());
  }

  getEnabled(config: LinterConfig = {}): LintRule[] {
    const { enabledRules, disabledRules = [] } = config;

    return this.getAll().filter(rule => {
      if (disabledRules.includes(rule.id)) return false;
      if (enabledRules && enabledRules.length > 0) {
        return enabledRules.includes(rule.id);
      }
      return true;
    });
  }
}

export const ruleRegistry = new RuleRegistry();

/**
 * Run all enabled rules against code
 */
export function lintCode(code: string, config: LinterConfig = {}): LintResult[] {
  const enabledRules = ruleRegistry.getEnabled(config);
  const results: LintResult[] = [];

  for (const rule of enabledRules) {
    try {
      const ruleResults = rule.check(code);

      // Apply severity overrides from config, or use result's own severity, or fall back to rule default
      const configSeverity = config.severityOverrides?.[rule.id];

      for (const result of ruleResults) {
        // Priority: config override > result's own severity > rule default
        const severity = configSeverity ?? result.severity ?? rule.defaultSeverity;
        results.push({
          ...result,
          severity,
          ruleId: rule.id,
        });
      }
    } catch (err) {
      console.error(`[Linter] Rule "${rule.id}" threw an error:`, err);
    }
  }

  // Sort by position
  return results.sort((a, b) => a.from - b.from);
}
