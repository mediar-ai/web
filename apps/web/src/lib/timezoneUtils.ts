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

/**
 * Enhanced picker utility functions
 */

/**
 * Convert Date to UTC datetime-local format for UTC mode
 * @param date - Date to convert
 * @returns String in YYYY-MM-DDTHH:MM format representing UTC time
 */
export const dateToUTCString = (date: Date): string => {
  return date.toISOString().slice(0, 16);
};

/**
 * Parse datetime-local input as UTC time
 * @param dateString - String from datetime-local input
 * @returns Date object interpreting the input as UTC time
 */
export const dateStringToUTC = (dateString: string): Date => {
  return new Date(dateString + 'Z'); // Add Z to interpret as UTC
};

/**
 * Convert between local and UTC based on timezone mode
 * @param date - Date to convert
 * @param fromTimezone - Source timezone mode
 * @param toTimezone - Target timezone mode
 * @returns Converted date
 */
export const convertTimezone = (
  date: Date, 
  fromTimezone: 'local' | 'utc', 
  toTimezone: 'local' | 'utc'
): Date => {
  if (fromTimezone === toTimezone) {
    return date;
  }

  if (fromTimezone === 'local' && toTimezone === 'utc') {
    // Convert local time to UTC
    return new Date(date.getTime() + (date.getTimezoneOffset() * 60000));
  } else {
    // Convert UTC to local time
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  }
};

/**
 * Format date range for display with timezone indicator
 * @param startDate - Start date
 * @param endDate - End date
 * @param timezone - Timezone mode
 * @param includeTime - Whether to include time in display
 * @returns Formatted date range string
 */
export const formatDateRangeDisplay = (
  startDate: Date | null,
  endDate: Date | null,
  timezone: 'local' | 'utc' = 'local',
  includeTime: boolean = true
): string => {
  if (!startDate) {
    return 'No date selected';
  }

  const timezoneSuffix = timezone === 'utc' ? ' UTC' : ` ${getTimezoneShort()}`;

  if (!endDate) {
    return startDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...(includeTime && {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    }) + timezoneSuffix;
  }

  const startFormatted = startDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(includeTime && {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  });

  const endFormatted = endDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(includeTime && {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  });

  return `${startFormatted} - ${endFormatted}${timezoneSuffix}`;
};

/**
 * Get current date boundaries for quick options
 * @returns Object with common date boundaries
 */
export const getDateBoundaries = () => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  startOfMonth.setHours(0, 0, 0, 0);

  return {
    now,
    startOfDay,
    endOfDay,
    startOfWeek,
    startOfMonth,
    yesterday: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    lastWeek: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    lastMonth: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  };
}; 