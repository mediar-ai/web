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
  
  // Seconds are not checked - Vercel triggers at random seconds
  const minute = timeInTz.getMinutes();
  const hour = timeInTz.getHours();
  const day = timeInTz.getDate();
  const month = timeInTz.getMonth() + 1; // JS months are 0-based
  const dayOfWeek = timeInTz.getDay(); // 0 = Sunday

  // IMPORTANT: Skip second matching for Vercel cron compatibility
  // Vercel cron triggers at random seconds, not at second=0
  // So we ignore the seconds field to allow workflows to trigger
  return (
    // matchesCronField(parsed.second, second) &&  // DISABLED for Vercel
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
 * Calculate next N execution times for a cron expression
 */
export function calculateNextExecutions(
  expression: string,
  timezone: string,
  count: number = 5
): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cronParser = require('cron-parser');
    const interval = cronParser.parseExpression(expression, {
      currentDate: new Date(),
      tz: timezone,
      iterator: true
    });

    const executions: string[] = [];
    for (let i = 0; i < count; i++) {
      const next = interval.next();
      if (!next.done && next.value) {
        const date = next.value.toDate();
        executions.push(
          date.toLocaleString('en-US', {
            timeZone: timezone,
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short',
          })
        );
      }
    }

    return executions;
  } catch (error) {
    console.error('Error calculating next executions:', error);
    return [];
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

  // Simple descriptions for common exact patterns
  if (expression === '* * * * * *') return 'Every second';
  if (expression === '0 * * * * *') return 'Every minute';
  if (expression === '0 0 * * * *') return 'Every hour';
  if (expression === '0 0 0 * * *') return 'Every day at midnight';
  if (expression === '0 0 9 * * 1-5') return 'Weekdays at 9 AM';
  if (expression === '0 0 0 * * 1') return 'Every Monday at midnight';
  if (expression === '0 0 */2 * * *') return 'Every 2 hours';
  if (expression === '0 */5 * * * *') return 'Every 5 minutes';

  // Build description piece by piece
  const parts: string[] = [];

  // Frequency (minute field is most important for describing frequency)
  if (parsed.minute === '*') {
    parts.push('Every minute');
  } else if (parsed.minute.startsWith('*/')) {
    const interval = parsed.minute.substring(2);
    parts.push(`Every ${interval} minutes`);
  } else if (parsed.minute.includes(',')) {
    const minutes = parsed.minute.split(',').join(', ');
    parts.push(`At minutes ${minutes}`);
  } else if (parsed.minute.includes('-')) {
    const [start, end] = parsed.minute.split('-');
    parts.push(`Minutes ${start}-${end}`);
  } else {
    parts.push(`At minute ${parsed.minute}`);
  }

  // Hour
  if (parsed.hour !== '*') {
    if (parsed.hour.startsWith('*/')) {
      const interval = parsed.hour.substring(2);
      parts.push(`of every ${interval} hours`);
    } else if (parsed.hour.includes(',')) {
      const hours = parsed.hour.split(',').map(h => {
        const hour = parseInt(h);
        return hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
      }).join(', ');
      parts.push(`at ${hours}`);
    } else if (parsed.hour.includes('-')) {
      const [start, end] = parsed.hour.split('-');
      const startHour = parseInt(start);
      const endHour = parseInt(end);
      const startStr = startHour === 0 ? '12 AM' : startHour < 12 ? `${startHour} AM` : startHour === 12 ? '12 PM' : `${startHour - 12} PM`;
      const endStr = endHour === 0 ? '12 AM' : endHour < 12 ? `${endHour} AM` : endHour === 12 ? '12 PM' : `${endHour - 12} PM`;
      parts.push(`between ${startStr} and ${endStr}`);
    } else {
      const hour = parseInt(parsed.hour);
      const hourStr = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
      parts.push(`at ${hourStr}`);
    }
  }

  // Day of week
  if (parsed.dayOfWeek !== '*') {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (parsed.dayOfWeek.includes(',')) {
      const days = parsed.dayOfWeek.split(',').map(d => dayNames[parseInt(d)]).join(', ');
      parts.push(`on ${days}`);
    } else if (parsed.dayOfWeek.includes('-')) {
      const [start, end] = parsed.dayOfWeek.split('-');
      const startDay = dayNames[parseInt(start)];
      const endDay = dayNames[parseInt(end)];
      parts.push(`on ${startDay} through ${endDay}`);
    } else {
      parts.push(`on ${dayNames[parseInt(parsed.dayOfWeek)]}`);
    }
  }

  // Day of month
  if (parsed.day !== '*') {
    if (parsed.day === '1') {
      parts.push('on the 1st of the month');
    } else if (parsed.day === 'L') {
      parts.push('on the last day of the month');
    } else if (parsed.day.includes(',')) {
      const days = parsed.day.split(',').join(', ');
      parts.push(`on days ${days} of the month`);
    } else {
      parts.push(`on day ${parsed.day} of the month`);
    }
  }

  // Month
  if (parsed.month !== '*') {
    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    if (parsed.month.includes(',')) {
      const months = parsed.month.split(',').map(m => monthNames[parseInt(m)]).join(', ');
      parts.push(`in ${months}`);
    } else if (parsed.month.includes('-')) {
      const [start, end] = parsed.month.split('-');
      const startMonth = monthNames[parseInt(start)];
      const endMonth = monthNames[parseInt(end)];
      parts.push(`from ${startMonth} to ${endMonth}`);
    } else {
      parts.push(`in ${monthNames[parseInt(parsed.month)]}`);
    }
  }

  return parts.join(' ');
}
