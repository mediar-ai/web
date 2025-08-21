'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EnhancedDateTimePicker } from '@/components/ui/enhanced-datetime-picker';
import { Label } from '@/components/ui/label';
import { getTimezoneDisplay } from '@/lib/timezoneUtils';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

interface TimeBoundary {
  startDate: Date | null;
  endDate: Date | null;
}

interface QuickOption {
  label: string;
  minutes: number;
}

interface TimeBoundarySelectorProps {
  selectedBoundary: TimeBoundary;
  onBoundaryChange: (boundary: TimeBoundary) => void;
  onClear?: () => void; // Add this optional prop
  disabled?: boolean;
  userId?: string; // Added userId prop
  required?: boolean; // Added required prop for validation
}

interface UserDataRange {
  earliestTimestamp: string;
  latestTimestamp: string;
  totalRangeHours: number;
}

const QUICK_OPTIONS: QuickOption[] = [
  { label: '10 minutes', minutes: 10 },
  { label: '60 minutes', minutes: 60 },
  { label: '24 hours', minutes: 24 * 60 },
];



export function TimeBoundarySelector({ 
  selectedBoundary, 
  onBoundaryChange,
  onClear,
  disabled = false,
  userId,
  required = false
}: TimeBoundarySelectorProps) {
  const [selectedQuickOption, setSelectedQuickOption] = useState<number | null>(null);
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [userDataRange, setUserDataRange] = useState<UserDataRange | null>(null);
  const [isLoadingDataRange, setIsLoadingDataRange] = useState(false);

  // Fetch user's data range when userId changes
  useEffect(() => {
    if (userId) {
      setIsLoadingDataRange(true);
      fetch(`/api/users/${userId}/data-range`)
        .then(response => response.json())
        .then(data => {
          if (data.earliestTimestamp && data.latestTimestamp) {
            setUserDataRange(data);
            console.log(`[STATS] User data range: ${data.earliestTimestamp} to ${data.latestTimestamp} (${data.totalRangeHours}h total)`);
          } else {
            console.warn('No data range found for user:', userId);
            setUserDataRange(null);
          }
        })
        .catch(error => {
          console.error('Error fetching user data range:', error);
          setUserDataRange(null);
        })
        .finally(() => {
          setIsLoadingDataRange(false);
        });
    }
  }, [userId]);

  // Update custom date inputs when selectedBoundary changes from external source
  useEffect(() => {
    if (selectedBoundary.startDate && selectedBoundary.endDate) {
      // Only auto-detect quick options if not already in custom range mode
      if (!useCustomRange && userDataRange) {
        // Check if this matches any quick option based on user's data range
        const latestDataTime = new Date(userDataRange.latestTimestamp).getTime();
        const selectedStartTime = selectedBoundary.startDate.getTime();
        const diffMinutes = Math.round((latestDataTime - selectedStartTime) / (1000 * 60));
        const matchingOptionIndex = QUICK_OPTIONS.findIndex(opt => Math.abs(opt.minutes - diffMinutes) < 2);
        
        if (matchingOptionIndex >= 0) {
          setSelectedQuickOption(matchingOptionIndex);
          setUseCustomRange(false);
        } else {
          setSelectedQuickOption(null);
          setUseCustomRange(true);
        }
      }
    }
  }, [selectedBoundary, useCustomRange, userDataRange]);

  const handleQuickOptionSelect = (optionIndex: number) => {
    const option = QUICK_OPTIONS[optionIndex];
    
    // Always use current time as the end date for quick options
    // This ensures 24-hour selection means "last 24 hours from now"
    const endDate: Date = new Date();
    let startDate: Date = new Date(endDate.getTime() - option.minutes * 60 * 1000);
    
    // If we have user data range, ensure we don't go before the user's earliest data
    if (userDataRange) {
      const earliestDate = new Date(userDataRange.earliestTimestamp);
      if (startDate < earliestDate) {
        startDate = earliestDate;
        console.log(`🕐 Quick option: ${option.label} adjusted to user's earliest data: ${startDate.toISOString()} to ${endDate.toISOString()}`);
      } else {
        console.log(`🕐 Quick option: ${option.label} from current time: ${startDate.toISOString()} to ${endDate.toISOString()}`);
      }
    } else {
      console.log(`🕐 Quick option: ${option.label} from current time: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    }
    
    setSelectedQuickOption(optionIndex);
    setUseCustomRange(false);
    onBoundaryChange({ startDate, endDate });
  };

  const handleCustomRangeToggle = () => {
    const newUseCustomRange = !useCustomRange;
    setUseCustomRange(newUseCustomRange);
    setSelectedQuickOption(null);
    
    if (newUseCustomRange) {
      // Switching to custom range - initialize with current values or reasonable defaults
      if (!selectedBoundary.startDate || !selectedBoundary.endDate) {
        let defaultEnd: Date;
        let defaultStart: Date;
        
        if (userDataRange) {
          // Use user's data range as defaults
          defaultEnd = new Date(userDataRange.latestTimestamp);
          defaultStart = new Date(userDataRange.earliestTimestamp);
        } else {
          // Fallback to current time
          defaultEnd = new Date();
          defaultStart = new Date(defaultEnd.getTime() - 60 * 60 * 1000); // 1 hour ago
        }
        
        onBoundaryChange({ startDate: defaultStart, endDate: defaultEnd });
      }
    }
  };

  const handleClear = () => {
    setSelectedQuickOption(null);
    setUseCustomRange(false);
    onBoundaryChange({ startDate: null, endDate: null });
    onClear?.(); // Call the onClear prop if provided
  };

  const isInvalid = required && (!selectedBoundary.startDate || !selectedBoundary.endDate);

  return (
    <Card className={cn("w-full border-black", isInvalid && "border-red-500 border-2")}>
      <CardContent className="p-3">
        {/* Everything in one line */}
        <div className="flex items-center gap-3 flex-wrap mb-2">
          {/* Title */}
          <Label className="text-sm font-semibold">
            Time Range for Synthesis
            {isLoadingDataRange && <span className="ml-2 text-xs text-muted-foreground">(Loading data range...)</span>}
          </Label>
          
          {/* Time selection buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {QUICK_OPTIONS.map((option, index) => (
              <Button
                key={index}
                variant={selectedQuickOption === index ? "default" : "outline"}
                size="sm"
                onClick={() => handleQuickOptionSelect(index)}
                disabled={disabled || isLoadingDataRange}
                className={cn(
                  "h-8 text-xs border-black",
                  selectedQuickOption === index 
                    ? "bg-black text-white border-black" 
                    : "hover:bg-gray-100"
                )}
              >
                {option.label}
              </Button>
            ))}
            <Button
              variant={useCustomRange ? "default" : "outline"}
              size="sm"
              onClick={handleCustomRangeToggle}
              disabled={disabled}
              className={cn(
                "h-8 text-xs border-black",
                useCustomRange 
                  ? "bg-black text-white border-black" 
                  : "hover:bg-gray-100"
              )}
            >
              Custom Range
            </Button>
          </div>
          
          {/* Clear button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={disabled || (!selectedBoundary.startDate && !selectedBoundary.endDate)}
            className="h-8 px-2 text-xs border-black hover:bg-gray-100 ml-auto"
          >
            Clear
          </Button>
        </div>
        
        {/* Timezone and selected range on second line */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>({getTimezoneDisplay()})</span>
          {selectedBoundary.startDate && selectedBoundary.endDate && (
            <span>
              {selectedBoundary.startDate.toLocaleDateString()} {selectedBoundary.startDate.toLocaleTimeString()} - {selectedBoundary.endDate.toLocaleDateString()} {selectedBoundary.endDate.toLocaleTimeString()}
              <span className="ml-1 opacity-75">
                (Local Time)
              </span>
            </span>
          )}
        </div>

        {/* Custom Date Inputs */}
        {useCustomRange && (
          <div className="mt-3">
            <EnhancedDateTimePicker
              startDate={selectedBoundary.startDate}
              endDate={selectedBoundary.endDate}
              onDateTimeChange={(startDate, endDate) => {
                onBoundaryChange({ startDate, endDate });
              }}
              mode="range"
              showTime={true}
              timezone="local"
              disabled={disabled}
              placeholder="Select custom date range"
              compact={true}
              className="w-full"
            />
          </div>
        )}
        
        {/* Validation message */}
        {isInvalid && (
          <div className="mt-2 text-sm text-red-600">
            Please select a timeframe to proceed with timeline annotations.
          </div>
        )}
      </CardContent>
    </Card>
  );
}