"use client"

import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import * as React from "react"
import { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Label } from "@/components/ui/label"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface EnhancedDateTimePickerProps {
  // Date range selection
  startDate?: Date | null;
  endDate?: Date | null;
  onDateTimeChange: (startDate: Date | null, endDate: Date | null) => void;
  
  // Configuration options
  mode?: 'single' | 'range'; // Single date/time or date range
  showTime?: boolean; // Include time selection
  timezone?: 'local' | 'utc'; // Timezone handling
  disabled?: boolean;
  
  // Quick options (optional)
  quickOptions?: Array<{label: string, minutes: number}>;
  onQuickOptionSelect?: (minutes: number) => void;
  
  // Styling & labels
  placeholder?: string;
  className?: string;
  compact?: boolean; // Smaller size for tight layouts
}

export function EnhancedDateTimePicker({
  startDate,
  endDate,
  onDateTimeChange,
  mode = 'range',
  showTime = true,
  timezone = 'local',
  disabled = false,
  quickOptions = [],
  onQuickOptionSelect,
  placeholder,
  className,
  compact = false
}: EnhancedDateTimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [tempStartDate, setTempStartDate] = React.useState<Date | null>(startDate || null)
  const [tempEndDate, setTempEndDate] = React.useState<Date | null>(endDate || null)
  const [startTime, setStartTime] = React.useState({ hour: '00', minute: '00' })
  const [endTime, setEndTime] = React.useState({ hour: '23', minute: '59' })

  // Sync external dates with internal state
  React.useEffect(() => {
    setTempStartDate(startDate || null)
    setTempEndDate(endDate || null)
    
    if (startDate && showTime) {
      setStartTime({
        hour: String(startDate.getHours()).padStart(2, '0'),
        minute: String(startDate.getMinutes()).padStart(2, '0')
      })
    }
    
    if (endDate && showTime) {
      setEndTime({
        hour: String(endDate.getHours()).padStart(2, '0'),
        minute: String(endDate.getMinutes()).padStart(2, '0')
      })
    }
  }, [startDate, endDate, showTime])

  // Helper to combine date and time
  const combineDateTime = (date: Date | null, time: {hour: string, minute: string}): Date | null => {
    if (!date) return null
    const combined = new Date(date)
    combined.setHours(parseInt(time.hour), parseInt(time.minute), 0, 0)
    return combined
  }

  // Handle calendar date selection
  const handleDateSelect = (dateRange: DateRange | undefined) => {
    if (mode === 'single') {
      setTempStartDate(dateRange?.from || null)
      setTempEndDate(null)
    } else {
      setTempStartDate(dateRange?.from || null)
      setTempEndDate(dateRange?.to || null)
    }
  }

  // Handle quick option selection
  const handleQuickOption = (minutes: number) => {
    const now = new Date()
    const startDate = new Date(now.getTime() - minutes * 60 * 1000)
    
    setTempStartDate(startDate)
    setTempEndDate(now)
    
    if (showTime) {
      setStartTime({
        hour: String(startDate.getHours()).padStart(2, '0'),
        minute: String(startDate.getMinutes()).padStart(2, '0')
      })
      setEndTime({
        hour: String(now.getHours()).padStart(2, '0'),
        minute: String(now.getMinutes()).padStart(2, '0')
      })
    }
    
    if (onQuickOptionSelect) {
      onQuickOptionSelect(minutes)
    }
  }

  // Apply the selection
  const handleApply = () => {
    let finalStartDate = tempStartDate
    let finalEndDate = mode === 'single' ? tempStartDate : tempEndDate

    if (showTime && finalStartDate) {
      finalStartDate = combineDateTime(finalStartDate, startTime)
    }
    
    if (showTime && finalEndDate && mode === 'range') {
      finalEndDate = combineDateTime(finalEndDate, endTime)
    }

    onDateTimeChange(finalStartDate, finalEndDate)
    setIsOpen(false)
  }

  // Cancel and revert
  const handleCancel = () => {
    setTempStartDate(startDate || null)
    setTempEndDate(endDate || null)
    setIsOpen(false)
  }

  // Generate hour options
  const hourOptions = Array.from({ length: 24 }, (_, i) => 
    String(i).padStart(2, '0')
  )

  // Generate minute options
  const minuteOptions = Array.from({ length: 60 }, (_, i) => 
    String(i).padStart(2, '0')
  )

  // Format display text
  const getDisplayText = () => {
    if (!startDate) {
      return placeholder || "Select date & time"
    }

    if (mode === 'single') {
      return format(startDate, showTime ? "MMM dd, yyyy HH:mm" : "MMM dd, yyyy")
    }

    if (startDate && endDate) {
      const startFormat = showTime ? "MMM dd, yyyy HH:mm" : "MMM dd, yyyy"
      const endFormat = showTime ? "MMM dd, yyyy HH:mm" : "MMM dd, yyyy"
      return `${format(startDate, startFormat)} - ${format(endDate, endFormat)}`
    }

    return format(startDate, showTime ? "MMM dd, yyyy HH:mm" : "MMM dd, yyyy")
  }

  const buttonSize = compact ? "sm" : "default"
  const buttonHeight = compact ? "h-8" : "h-10"

  return (
    <div className={cn("grid gap-2", className)}>
      {/* Quick Options */}
      {quickOptions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {quickOptions.map((option, index) => (
            <Button
              key={index}
              variant="outline"
              size={buttonSize}
              onClick={() => handleQuickOption(option.minutes)}
              disabled={disabled}
              className={cn(
                "text-xs border-black hover:bg-gray-100",
                buttonHeight
              )}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}

      {/* Main Picker */}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            className={cn(
              "justify-start text-left font-normal border-black",
              !startDate && "text-muted-foreground",
              buttonHeight,
              compact ? "text-xs" : "text-sm"
            )}
          >
            <CalendarIcon className={cn("mr-2", compact ? "h-3 w-3" : "h-4 w-4")} />
            {getDisplayText()}
          </Button>
        </PopoverTrigger>
        
        <PopoverContent className="w-auto p-0" align="start">
          {/* Calendar */}
          {mode === 'single' ? (
            <Calendar
              initialFocus
              mode="single"
              defaultMonth={tempStartDate || startDate || undefined}
              selected={tempStartDate || undefined}
              onSelect={(date) => handleDateSelect(date ? { from: date, to: undefined } : undefined)}
              numberOfMonths={1}
            />
          ) : (
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={tempStartDate || startDate || undefined}
              selected={tempStartDate || tempEndDate ? { from: tempStartDate || undefined, to: tempEndDate || undefined } : undefined}
              onSelect={handleDateSelect}
              numberOfMonths={2}
            />
          )}

          {/* Time Selection */}
          {showTime && (
            <div className="p-2 border-t bg-gray-50">
              {mode === 'single' ? (
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-medium min-w-[32px]">Time:</Label>
                  <Select value={startTime.hour} onValueChange={(hour) => setStartTime({...startTime, hour})}>
                    <SelectTrigger className="w-16 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {hourOptions.map(hour => (
                        <SelectItem key={hour} value={hour}>{hour}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs">:</span>
                  <Select value={startTime.minute} onValueChange={(minute) => setStartTime({...startTime, minute})}>
                    <SelectTrigger className="w-16 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {minuteOptions.map(minute => (
                        <SelectItem key={minute} value={minute}>{minute}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium">Start:</Label>
                    <Select value={startTime.hour} onValueChange={(hour) => setStartTime({...startTime, hour})}>
                      <SelectTrigger className="w-16 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {hourOptions.map(hour => (
                          <SelectItem key={hour} value={hour}>{hour}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs">:</span>
                    <Select value={startTime.minute} onValueChange={(minute) => setStartTime({...startTime, minute})}>
                      <SelectTrigger className="w-16 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {minuteOptions.map(minute => (
                          <SelectItem key={minute} value={minute}>{minute}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium">End:</Label>
                    <Select value={endTime.hour} onValueChange={(hour) => setEndTime({...endTime, hour})}>
                      <SelectTrigger className="w-16 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {hourOptions.map(hour => (
                          <SelectItem key={hour} value={hour}>{hour}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs">:</span>
                    <Select value={endTime.minute} onValueChange={(minute) => setEndTime({...endTime, minute})}>
                      <SelectTrigger className="w-16 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {minuteOptions.map(minute => (
                          <SelectItem key={minute} value={minute}>{minute}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between items-center p-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              className="h-7 px-3 text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={!tempStartDate || (mode === 'range' && !tempEndDate)}
              className="h-7 px-3 text-xs"
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Timezone Indicator */}
      {(startDate || endDate) && (
        <span className="text-xs text-muted-foreground">
          Times in {timezone === 'local' ? 'Local Time' : 'UTC'}
        </span>
      )}
    </div>
  )
} 