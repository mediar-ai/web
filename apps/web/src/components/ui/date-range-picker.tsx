"use client"

import * as React from "react";
import { DateRange } from "react-day-picker";
import { EnhancedDateTimePicker } from "./enhanced-datetime-picker";

interface DateRangePickerProps extends React.ComponentProps<"div"> {
    date: DateRange | undefined;
    onDateChange: (date: DateRange | undefined) => void;
    showTime?: boolean; // Optional time selection
    timezone?: 'local' | 'utc'; // Optional timezone mode
    placeholder?: string;
}

export function DateRangePicker({
  className,
  date,
  onDateChange,
  showTime = false, // Default to date-only for backward compatibility
  timezone = 'local',
  placeholder = "Pick a date range"
}: DateRangePickerProps) {
  
  const handleDateTimeChange = (startDate: Date | null, endDate: Date | null) => {
    if (startDate && endDate) {
      onDateChange({ from: startDate, to: endDate })
    } else if (startDate) {
      onDateChange({ from: startDate, to: undefined })
    } else {
      onDateChange(undefined)
    }
  }

  return (
    <EnhancedDateTimePicker
      startDate={date?.from || null}
      endDate={date?.to || null}
      onDateTimeChange={handleDateTimeChange}
      mode="range"
      showTime={showTime}
      timezone={timezone}
      placeholder={placeholder}
      className={className}
    />
  )
} 