'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

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
  disabled?: boolean;
}

const QUICK_OPTIONS: QuickOption[] = [
  { label: '10 minutes', minutes: 10 },
  { label: '60 minutes', minutes: 60 },
  { label: '24 hours', minutes: 24 * 60 },
];

// Helper function to convert UTC Date to datetime-local format (displaying UTC time)
const dateToUTCString = (date: Date): string => {
  return date.toISOString().slice(0, 16);
};

// Helper function to interpret datetime-local input as UTC time
const dateStringToUTC = (dateString: string): Date => {
  // Treat the input as UTC by appending 'Z'
  return new Date(dateString + ':00.000Z');
};

export function TimeBoundarySelector({ 
  selectedBoundary, 
  onBoundaryChange,
  disabled = false 
}: TimeBoundarySelectorProps) {
  const [selectedQuickOption, setSelectedQuickOption] = useState<number | null>(null);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [useCustomRange, setUseCustomRange] = useState(false);

  // Update custom date inputs when selectedBoundary changes from external source
  useEffect(() => {
    if (selectedBoundary.startDate && selectedBoundary.endDate) {
      const startStr = dateToUTCString(selectedBoundary.startDate);
      const endStr = dateToUTCString(selectedBoundary.endDate);
      setCustomStartDate(startStr);
      setCustomEndDate(endStr);
      
      // Only auto-detect quick options if not already in custom range mode
      if (!useCustomRange) {
        // Check if this matches any quick option
        const now = new Date();
        const diffMinutes = Math.round((now.getTime() - selectedBoundary.startDate.getTime()) / (1000 * 60));
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
  }, [selectedBoundary, useCustomRange]);

  const handleQuickOptionSelect = (optionIndex: number) => {
    const option = QUICK_OPTIONS[optionIndex];
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - option.minutes * 60 * 1000);
    
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
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      const startStr = selectedBoundary.startDate ? 
        dateToUTCString(selectedBoundary.startDate) :
        dateToUTCString(oneHourAgo);
      const endStr = selectedBoundary.endDate ? 
        dateToUTCString(selectedBoundary.endDate) :
        dateToUTCString(now);
      
      setCustomStartDate(startStr);
      setCustomEndDate(endStr);
      
      // Only update boundary if we don't already have dates
      if (!selectedBoundary.startDate || !selectedBoundary.endDate) {
        onBoundaryChange({
          startDate: dateStringToUTC(startStr),
          endDate: dateStringToUTC(endStr)
        });
      }
    }
  };

  const handleCustomDateChange = (type: 'start' | 'end', value: string) => {
    if (type === 'start') {
      setCustomStartDate(value);
    } else {
      setCustomEndDate(value);
    }
    
    // Update boundary if both dates are valid - interpret as UTC
    const startDate = type === 'start' ? dateStringToUTC(value) : dateStringToUTC(customStartDate);
    const endDate = type === 'end' ? dateStringToUTC(value) : dateStringToUTC(customEndDate);
    
    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && startDate <= endDate) {
      onBoundaryChange({ startDate, endDate });
    }
  };

  const resetToBoundary = () => {
    setSelectedQuickOption(null);
    setUseCustomRange(false);
    setCustomStartDate('');
    setCustomEndDate('');
    onBoundaryChange({ startDate: null, endDate: null });
  };

  return (
    <Card className="w-full border-black">
      <CardContent className="p-4">
        {/* Everything in one line */}
        <div className="flex items-center gap-4 flex-wrap">
          <Label className="text-sm font-semibold whitespace-nowrap">Time Range for Synthesis</Label>
          
          {/* Time selection buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {QUICK_OPTIONS.map((option, index) => (
              <Button
                key={index}
                variant={selectedQuickOption === index ? "default" : "outline"}
                size="sm"
                onClick={() => handleQuickOptionSelect(index)}
                disabled={disabled}
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
          
          {/* Clear button and selected range */}
          <div className="flex items-center gap-2 ml-auto">
            {selectedBoundary.startDate && selectedBoundary.endDate && (
              <span className="text-xs text-muted-foreground">
                {selectedBoundary.startDate.toLocaleDateString()} {selectedBoundary.startDate.toLocaleTimeString()} - {selectedBoundary.endDate.toLocaleDateString()} {selectedBoundary.endDate.toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={resetToBoundary}
              disabled={disabled || (!selectedBoundary.startDate && !selectedBoundary.endDate)}
              className="h-8 px-2 text-xs border-black hover:bg-gray-100"
            >
              Clear
            </Button>
          </div>
        </div>

        {/* Custom Date Inputs */}
        {useCustomRange && (
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="space-y-1">
              <Label htmlFor="start-date" className="text-xs">Start Date & Time</Label>
              <Input
                id="start-date"
                type="datetime-local"
                value={customStartDate}
                onChange={(e) => handleCustomDateChange('start', e.target.value)}
                disabled={disabled}
                className="h-8 text-xs border-black focus:border-black focus:ring-black"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="end-date" className="text-xs">End Date & Time</Label>
              <Input
                id="end-date"
                type="datetime-local"
                value={customEndDate}
                onChange={(e) => handleCustomDateChange('end', e.target.value)}
                disabled={disabled}
                className="h-8 text-xs border-black focus:border-black focus:ring-black"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}