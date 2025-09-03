/**
 * Cron Expression Parser and Scheduler Utilities
 * Supports 6-field cron format: SECOND MINUTE HOUR DAY MONTH DAY_OF_WEEK
 */

export interface CronConfig {
  expression: string;
  timezone?: string;
  enabled?: boolean;
  maxConcurrent?: number;
  retryOnFailure?: boolean;
  retryCount?: number;
  stopOnError?: boolean;
}

export interface ParsedCronExpression {
  second: string;
  minute: string;
  hour: string;
  day: string;
  month: string;
  dayOfWeek: string;
  isValid: boolean;
  error?: string;
}

/**
 * Parse a 6-field cron expression
 */
export function parseCronExpression(expression: string): ParsedCronExpression {
  if (!expression || typeof expression !== 'string') {
    return {
      second: '*',
      minute: '*',
      hour: '*',
      day: '*',
      month: '*',
      dayOfWeek: '*',
      isValid: false,
      error: 'Invalid cron expression format'
    };
  }

  const fields = expression.trim().split(/\s+/);
  
  if (fields.length !== 6) {
    return {
      second: '*',
      minute: '*',
      hour: '*',
      day: '*',
      month: '*',
      dayOfWeek: '*',
      isValid: false,
      error: `Expected 6 fields, got ${fields.length}. Format: SECOND MINUTE HOUR DAY MONTH DAY_OF_WEEK`
    };
  }

  const [second, minute, hour, day, month, dayOfWeek] = fields;

  // Basic validation
  const validationErrors: string[] = [];

  if (!isValidCronField(second, 0, 59)) {
    validationErrors.push('Invalid second field (0-59)');
  }
  if (!isValidCronField(minute, 0, 59)) {
    validationErrors.push('Invalid minute field (0-59)');
  }
  if (!isValidCronField(hour, 0, 23)) {
    validationErrors.push('Invalid hour field (0-23)');
  }
  if (!isValidCronField(day, 1, 31)) {
    validationErrors.push('Invalid day field (1-31)');
  }
  if (!isValidCronField(month, 1, 12)) {
    validationErrors.push('Invalid month field (1-12)');
  }
  if (!isValidCronField(dayOfWeek, 0, 7)) {
    validationErrors.push('Invalid day of week field (0-7, where 0 and 7 are Sunday)');
  }

  return {
    second,
    minute,
    hour,
    day,
    month,
    dayOfWeek,
    isValid: validationErrors.length === 0,
    error: validationErrors.length > 0 ? validationErrors.join(', ') : undefined
  };
}

/**
 * Validate a single cron field
 */
function isValidCronField(field: string, min: number, max: number): boolean {
  if (field === '*') return true;
  
  // Handle ranges (e.g., "1-5")
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    return !isNaN(start) && !isNaN(end) && start >= min && end <= max && start <= end;
  }
  
  // Handle step values (e.g., "*/5", "1-10/2")
  if (field.includes('/')) {
    const [range, step] = field.split('/');
    const stepNum = Number(step);
    if (isNaN(stepNum) || stepNum <= 0) return false;
    
    if (range === '*') return true;
    if (range.includes('-')) {
      const [start, end] = range.split('-').map(Number);
      return !isNaN(start) && !isNaN(end) && start >= min && end <= max;
    }
    const rangeNum = Number(range);
    return !isNaN(rangeNum) && rangeNum >= min && rangeNum <= max;
  }
  
  // Handle comma-separated values (e.g., "1,3,5")
  if (field.includes(',')) {
    const values = field.split(',').map(Number);
    return values.every(val => !isNaN(val) && val >= min && val <= max);
  }
  
  // Handle single number
  const num = Number(field);
  return !isNaN(num) && num >= min && num <= max;
}

/**
 * Calculate the next execution time for a cron expression
 */
export function getNextExecutionTime(
  cronExpression: string,
  _timezone: string = 'UTC',
  fromTime?: Date
): Date | null {
  const parsed = parseCronExpression(cronExpression);
  if (!parsed.isValid) {
    console.error('Invalid cron expression:', parsed.error);
    return null;
  }

  // For now, we'll use a simplified calculation
  // In production, you might want to use a library like node-cron or cron-parser
  const now = fromTime || new Date();
  const next = new Date(now.getTime() + 1000); // Add 1 second as a simple approximation
  
  // This is a simplified implementation
  // For production use, consider using a proper cron library
  return next;
}

/**
 * Check if a cron expression should execute at a given time
 */
export function shouldExecuteAt(cronExpression: string, time: Date, _timezone: string = 'UTC'): boolean {
  const parsed = parseCronExpression(cronExpression);
  if (!parsed.isValid) return false;

  // Convert time to specified timezone
  const timeInTz = new Date(time.toLocaleString('en-US', { timeZone: _timezone }));
  
  const second = timeInTz.getSeconds();
  const minute = timeInTz.getMinutes();
  const hour = timeInTz.getHours();
  const day = timeInTz.getDate();
  const month = timeInTz.getMonth() + 1; // JS months are 0-based
  const dayOfWeek = timeInTz.getDay(); // 0 = Sunday

  return (
    matchesCronField(parsed.second, second) &&
    matchesCronField(parsed.minute, minute) &&
    matchesCronField(parsed.hour, hour) &&
    matchesCronField(parsed.day, day) &&
    matchesCronField(parsed.month, month) &&
    matchesCronField(parsed.dayOfWeek, dayOfWeek)
  );
}

/**
 * Check if a value matches a cron field
 */
function matchesCronField(field: string, value: number): boolean {
  if (field === '*') return true;
  
  // Handle comma-separated values
  if (field.includes(',')) {
    const values = field.split(',').map(Number);
    return values.includes(value);
  }
  
  // Handle ranges
  if (field.includes('-') && !field.includes('/')) {
    const [start, end] = field.split('-').map(Number);
    return value >= start && value <= end;
  }
  
  // Handle step values
  if (field.includes('/')) {
    const [range, step] = field.split('/');
    const stepNum = Number(step);
    
    if (range === '*') {
      return value % stepNum === 0;
    }
    
    if (range.includes('-')) {
      const [start, end] = range.split('-').map(Number);
      return value >= start && value <= end && (value - start) % stepNum === 0;
    }
    
    const rangeNum = Number(range);
    return value >= rangeNum && (value - rangeNum) % stepNum === 0;
  }
  
  // Handle single number
  return Number(field) === value;
}

/**
 * Extract cron configuration from YAML workflow data
 */
export function extractCronConfigFromYAML(yamlContent: string): CronConfig | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require('js-yaml');
    const parsed = yaml.load(yamlContent);
    
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    // Check for cron expression at root level
    if (parsed.cron) {
      return {
        expression: parsed.cron,
        timezone: parsed.timezone || 'UTC',
        enabled: parsed.cron_enabled !== false, // Default to true if cron is specified
        maxConcurrent: parsed.max_concurrent || 1,
        retryOnFailure: parsed.retry_on_failure !== false,
        retryCount: parsed.retry_count || 3,
        stopOnError: parsed.stop_on_error !== false
      };
    }

    // Check for schedule block
    if (parsed.schedule && parsed.schedule.cron) {
      return {
        expression: parsed.schedule.cron,
        timezone: parsed.schedule.timezone || 'UTC',
        enabled: parsed.schedule.enabled !== false,
        maxConcurrent: parsed.schedule.max_concurrent || 1,
        retryOnFailure: parsed.schedule.retry_on_failure !== false,
        retryCount: parsed.schedule.retry_count || 3,
        stopOnError: parsed.stop_on_error !== false
      };
    }

    return null;
  } catch (error) {
    console.error('Error parsing YAML for cron config:', error);
    return null;
  }
}

/**
 * Generate human-readable description of cron expression
 */
export function describeCronExpression(expression: string): string {
  const parsed = parseCronExpression(expression);
  if (!parsed.isValid) {
    return `Invalid cron expression: ${parsed.error}`;
  }

  // Simple descriptions for common patterns
  if (expression === '* * * * * *') return 'Every second';
  if (expression === '0 * * * * *') return 'Every minute';
  if (expression === '0 0 * * * *') return 'Every hour';
  if (expression === '0 0 0 * * *') return 'Every day at midnight';
  if (expression === '0 0 9 * * 1-5') return 'Weekdays at 9 AM';
  if (expression === '0 0 0 * * 1') return 'Every Monday at midnight';
  if (expression === '0 0 */2 * * *') return 'Every 2 hours';
  if (expression === '0 */5 * * * *') return 'Every 5 minutes';
  
  // Generic description
  return `At ${parsed.second}s ${parsed.minute}m ${parsed.hour}h on day ${parsed.day} of month ${parsed.month}, day of week ${parsed.dayOfWeek}`;
}
