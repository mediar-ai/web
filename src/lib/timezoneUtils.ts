/**
 * Timezone utilities for consistent timestamp handling across the application
 */

/**
 * Get the user's timezone display name
 * @returns Formatted timezone string like "America/New_York (EST)" or "Local Time"
 */
export const getTimezoneDisplay = (): string => {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    const shortName = now.toLocaleDateString('en-US', { 
      timeZoneName: 'short' 
    }).split(', ')[1] || timezone;
    return `${timezone} (${shortName})`;
  } catch {
    return 'Local Time';
  }
};

/**
 * Get short timezone abbreviation only
 * @returns Short timezone like "EST" or "UTC"
 */
export const getTimezoneShort = (): string => {
  try {
    const now = new Date();
    return now.toLocaleDateString('en-US', { 
      timeZoneName: 'short' 
    }).split(', ')[1] || 'Local';
  } catch {
    return 'Local';
  }
};

/**
 * Format a date with timezone indicator for UI display
 * @param date - Date to format
 * @param options - Additional formatting options
 * @returns Formatted date string with timezone indicator
 */
export const formatDateWithTimezone = (
  date: Date | string, 
  options: {
    includeTimezone?: boolean;
    includeSeconds?: boolean;
    dateStyle?: 'short' | 'medium' | 'long';
  } = {}
): string => {
  const {
    includeTimezone = true,
    includeSeconds = false,
    dateStyle = 'short'
  } = options;

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(dateObj.getTime())) {
    return 'Invalid Date';
  }

  const timeOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: dateStyle === 'short' ? 'numeric' : dateStyle === 'medium' ? 'short' : 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(includeSeconds && { second: '2-digit' })
  };

  const timeString = dateObj.toLocaleString('en-US', timeOptions);

  if (includeTimezone) {
    const timezone = getTimezoneShort();
    return `${timeString} (${timezone})`;
  }

  return timeString;
};

/**
 * Convert Date to datetime-local format (user's local timezone)
 * @param date - Date to convert
 * @returns String in YYYY-MM-DDTHH:MM format for datetime-local inputs
 */
export const dateToLocalString = (date: Date): string => {
  // Get the local timezone offset and adjust the date
  const timezoneOffset = date.getTimezoneOffset() * 60000; // Convert to milliseconds
  const localDate = new Date(date.getTime() - timezoneOffset);
  return localDate.toISOString().slice(0, 16);
};

/**
 * Parse datetime-local input as user's local timezone
 * @param dateString - String from datetime-local input
 * @returns Date object in user's local timezone
 */
export const dateStringToLocal = (dateString: string): Date => {
  // Create date assuming local timezone (browser's default behavior)
  return new Date(dateString);
};

/**
 * Format time for UI timeline displays with consistent timezone handling
 * @param date - Date to format
 * @param includeDate - Whether to include date portion
 * @returns Formatted time string with timezone
 */
export const formatTimelineTime = (date: Date | string, includeDate = false): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(dateObj.getTime())) {
    return 'Invalid Time';
  }

  let options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };

  if (includeDate) {
    options = {
      ...options,
      month: 'short',
      day: 'numeric'
    };
  }

  const timeString = dateObj.toLocaleString('en-US', options);
  const timezone = getTimezoneShort();
  
  return `${timeString} ${timezone}`;
}; 