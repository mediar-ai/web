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

interface TimeBoundarySelectorProps {
  selectedBoundary: TimeBoundary;
  onBoundaryChange: (boundary: TimeBoundary) => void;
  disabled?: boolean;
}

type QuickOption = {
  label: string;
  minutes: number;
};

const QUICK_OPTIONS: QuickOption[] = [
  { label: '10 minutes', minutes: 10 },
  { label: '60 minutes', minutes: 60 },
  { label: '24 hours', minutes: 24 * 60 },
];

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
      const startStr = selectedBoundary.startDate.toISOString().slice(0, 16);
      const endStr = selectedBoundary.endDate.toISOString().slice(0, 16);
      setCustomStartDate(startStr);
      setCustomEndDate(endStr);
      
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
  }, [selectedBoundary]);

  const handleQuickOptionSelect = (optionIndex: number) => {
    const option = QUICK_OPTIONS[optionIndex];
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - option.minutes * 60 * 1000);
    
    setSelectedQuickOption(optionIndex);
    setUseCustomRange(false);
    onBoundaryChange({ startDate, endDate });
  };

  const handleCustomRangeToggle = () => {
    setUseCustomRange(!useCustomRange);
    setSelectedQuickOption(null);
    
    if (!useCustomRange) {
      // Switching to custom range - initialize with current values or reasonable defaults
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      const startStr = selectedBoundary.startDate ? 
        selectedBoundary.startDate.toISOString().slice(0, 16) :
        oneHourAgo.toISOString().slice(0, 16);
      const endStr = selectedBoundary.endDate ? 
        selectedBoundary.endDate.toISOString().slice(0, 16) :
        now.toISOString().slice(0, 16);
      
      setCustomStartDate(startStr);
      setCustomEndDate(endStr);
      
      onBoundaryChange({
        startDate: new Date(startStr),
        endDate: new Date(endStr)
      });
    }
  };

  const handleCustomDateChange = (type: 'start' | 'end', value: string) => {
    if (type === 'start') {
      setCustomStartDate(value);
    } else {
      setCustomEndDate(value);
    }
    
    // Update boundary if both dates are valid
    const startDate = type === 'start' ? new Date(value) : new Date(customStartDate);
    const endDate = type === 'end' ? new Date(value) : new Date(customEndDate);
    
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
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Time Range for Synthesis</Label>
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
          
          {/* Quick Options */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Quick Selection</Label>
            <div className="flex flex-wrap gap-2">
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
            </div>
          </div>

          {/* Custom Range Toggle */}
          <div className="flex items-center gap-2">
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
            {selectedBoundary.startDate && selectedBoundary.endDate && (
              <span className="text-xs text-muted-foreground">
                {selectedBoundary.startDate.toLocaleDateString()} {selectedBoundary.startDate.toLocaleTimeString()} - {selectedBoundary.endDate.toLocaleDateString()} {selectedBoundary.endDate.toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Custom Date Inputs */}
          {useCustomRange && (
            <div className="grid grid-cols-2 gap-4">
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
        </div>
      </CardContent>
    </Card>
  );
} 