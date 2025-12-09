'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  parseCronExpression,
  describeCronExpression,
  calculateNextExecutions,
} from '@/lib/cronParser';
import { Clock, AlertCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Common cron presets
const CRON_PRESETS = [
  { label: 'Custom', value: 'custom' },
  { label: 'Every minute', value: '0 * * * * *' },
  { label: 'Every 5 minutes', value: '0 */5 * * * *' },
  { label: 'Every 15 minutes', value: '0 */15 * * * *' },
  { label: 'Every 30 minutes', value: '0 */30 * * * *' },
  { label: 'Every hour', value: '0 0 * * * *' },
  { label: 'Every 2 hours', value: '0 0 */2 * * *' },
  { label: 'Daily at midnight', value: '0 0 0 * * *' },
  { label: 'Daily at 9 AM', value: '0 0 9 * * *' },
  { label: 'Daily at noon', value: '0 0 12 * * *' },
  { label: 'Daily at 6 PM', value: '0 0 18 * * *' },
  { label: 'Weekdays at 9 AM', value: '0 0 9 * * 1-5' },
  { label: 'Weekends at 10 AM', value: '0 0 10 * * 0,6' },
  { label: 'Every Monday at 9 AM', value: '0 0 9 * * 1' },
  { label: 'Every Friday at 5 PM', value: '0 0 17 * * 5' },
  { label: 'First day of month at midnight', value: '0 0 0 1 * *' },
  { label: 'Last day of month at 11 PM', value: '0 0 23 L * *' },
];

// Common timezones
const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Dubai',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
];

export interface CronConfig {
  expression: string;
  timezone: string;
  enabled: boolean;
  maxConcurrent?: number;
  /** @deprecated Only used for Python/YAML workflows. Rust executor handles infra retries automatically. */
  retryOnFailure?: boolean;
  /** @deprecated Only used for Python/YAML workflows. Rust executor handles infra retries automatically. */
  retryCount?: number;
  executorType?: 'python' | 'rust';
}

interface CronScheduleEditorProps {
  cronExpression?: string;
  cronTimezone?: string;
  cronEnabled?: boolean;
  cronMaxConcurrent?: number;
  /** @deprecated Only used for Python/YAML workflows */
  cronRetryOnFailure?: boolean;
  /** @deprecated Only used for Python/YAML workflows */
  cronRetryCount?: number;
  onChange: (config: CronConfig) => void;
  showAdvanced?: boolean;
  className?: string;
  /** Executor type - retry fields are excluded for 'rust' executor */
  executorType?: 'python' | 'rust';
}

export function CronScheduleEditor({
  cronExpression = '',
  cronTimezone = 'UTC',
  cronEnabled = false,
  cronMaxConcurrent: _cronMaxConcurrent = 1,
  cronRetryOnFailure: _cronRetryOnFailure = true,
  cronRetryCount: _cronRetryCount = 3,
  onChange,
  showAdvanced: _showAdvanced = false,
  className = '',
  executorType = 'python',
}: CronScheduleEditorProps) {
  const [enabled, setEnabled] = useState(cronEnabled);
  const [expression, setExpression] = useState(cronExpression);
  const [selectedPreset, setSelectedPreset] = useState(() => {
    // Find matching preset on initialization
    const match = CRON_PRESETS.find(p => p.value === cronExpression);
    return match ? match.value : 'custom';
  });
  const [timezone, setTimezone] = useState(cronTimezone);

  // Fixed values for advanced settings (not configurable)
  const maxConcurrent = 1;
  // Retry is only relevant for Python/YAML workflows
  // Rust executor handles infrastructure retries automatically; business logic retries are in workflow code
  const retryOnFailure = executorType === 'python';
  const retryCount = executorType === 'python' ? 3 : 0;

  // Parse and validate the cron expression
  const validation = useMemo(() => {
    if (!expression) return null;
    return parseCronExpression(expression);
  }, [expression]);

  const description = useMemo(() => {
    if (!expression || !validation?.isValid) return '';
    return describeCronExpression(expression);
  }, [expression, validation]);

  // Calculate next 5 execution times
  const nextExecutions = useMemo(() => {
    if (!expression || !validation?.isValid) return [];
    return calculateNextExecutions(expression, timezone, 5);
  }, [expression, validation, timezone]);

  // Update parent when any value changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    onChange({
      expression,
      timezone,
      enabled,
      maxConcurrent,
      retryOnFailure,
      retryCount,
    });
    // NOTE: onChange is intentionally excluded from deps to prevent infinite loops
    // The parent passes a stable callback or handles rerenders appropriately
  }, [
    expression,
    timezone,
    enabled,
    maxConcurrent,
    retryOnFailure,
    retryCount,
  ]);

  const handlePresetChange = (value: string) => {
    console.log('📅 Preset changed:', value);
    const preset = CRON_PRESETS.find(p => p.value === value);
    console.log('📅 Selected preset:', preset);

    setSelectedPreset(value);
    if (value !== 'custom') {
      setExpression(value);
      console.log('📅 Expression set to:', value);
    }
  };

  const handleExpressionChange = (value: string) => {
    setExpression(value);
    // Check if it matches a preset
    const matchingPreset = CRON_PRESETS.find(p => p.value === value);
    setSelectedPreset(matchingPreset ? matchingPreset.value : 'custom');
  };

  return (
    <Card className={cn('border-2 border-black', className)}>
      <CardContent className="p-6 space-y-4">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <Label htmlFor="cron-enabled" className="font-mono text-sm uppercase">
            Schedule Enabled
          </Label>
          <Switch
            id="cron-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            className="data-[state=checked]:bg-black"
          />
        </div>

        {enabled && (
          <>
            {/* Preset Selector */}
            <div className="space-y-2">
              <Label
                htmlFor="cron-preset"
                className="font-mono text-xs text-gray-600 uppercase"
              >
                Quick Presets
              </Label>
              <Select value={selectedPreset} onValueChange={handlePresetChange}>
                <SelectTrigger
                  id="cron-preset"
                  className="border-2 border-black font-mono"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map(preset => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Cron Expression Input */}
            <div className="space-y-2">
              <Label
                htmlFor="cron-expression"
                className="font-mono text-xs text-gray-600 uppercase"
              >
                Cron Expression (6-field format: SEC MIN HOUR DAY MONTH DOW)
              </Label>
              <Input
                id="cron-expression"
                value={expression}
                onChange={e => handleExpressionChange(e.target.value)}
                placeholder="0 0 9 * * 1-5"
                className={cn(
                  'font-mono border-2',
                  validation && !validation.isValid
                    ? 'border-red-600 focus:ring-red-600'
                    : 'border-black focus:ring-black'
                )}
              />

              {/* Validation Message */}
              {expression && (
                <div
                  className={cn(
                    'flex items-start gap-2 text-sm',
                    validation?.isValid ? 'text-gray-600' : 'text-red-600'
                  )}
                >
                  {validation?.isValid ? (
                    <>
                      <Check className="w-4 h-4 mt-0.5" />
                      <span>{description}</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 mt-0.5" />
                      <span>{validation?.error || 'Invalid expression'}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Timezone Selector */}
            <div className="space-y-2">
              <Label
                htmlFor="cron-timezone"
                className="font-mono text-xs text-gray-600 uppercase"
              >
                Timezone
              </Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger
                  id="cron-timezone"
                  className="border-2 border-black font-mono"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map(tz => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Next Executions Preview */}
            {validation?.isValid && nextExecutions.length > 0 && (
              <div className="space-y-2">
                <Label className="font-mono text-xs text-gray-600 uppercase flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Next 5 Executions
                </Label>
                <div className="bg-gray-50 border border-gray-200 rounded p-3">
                  <ul className="space-y-1 text-xs font-mono">
                    {nextExecutions.map((exec, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="text-gray-400">{i + 1}.</span>
                        <span>{exec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
