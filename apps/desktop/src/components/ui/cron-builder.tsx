import { ChevronDown } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";

interface CronBuilderProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

// Preset schedules for quick selection
const PRESETS = [
  { label: "Every minute", cron: "* * * * *", description: "Runs every minute" },
  { label: "Every 5 minutes", cron: "*/5 * * * *", description: "Runs every 5 minutes" },
  { label: "Every 15 minutes", cron: "*/15 * * * *", description: "Runs every 15 minutes" },
  { label: "Every hour", cron: "0 * * * *", description: "Runs at the start of every hour" },
  { label: "Every 6 hours", cron: "0 0,6,12,18 * * *", description: "Runs at midnight, 6am, noon, 6pm" },
  { label: "Daily at 9am", cron: "0 9 * * *", description: "Runs every day at 9:00 AM" },
  { label: "Daily at midnight", cron: "0 0 * * *", description: "Runs every day at midnight" },
  { label: "Weekdays at 9am", cron: "0 9 * * 1-5", description: "Runs Monday-Friday at 9:00 AM" },
  { label: "Weekly on Monday", cron: "0 9 * * 1", description: "Runs every Monday at 9:00 AM" },
  { label: "Monthly on 1st", cron: "0 9 1 * *", description: "Runs on the 1st of each month at 9:00 AM" },
] as const;

// Options for dropdowns
const MINUTES = Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, "0") }));
const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, "0") }));
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
const MONTHS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];
const DAYS_OF_WEEK = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

// Parse cron expression into components
function parseCron(cron: string): {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
} {
  const parts = cron.split(" ");
  return {
    minute: parts[0] || "*",
    hour: parts[1] || "*",
    dayOfMonth: parts[2] || "*",
    month: parts[3] || "*",
    dayOfWeek: parts[4] || "*",
  };
}

// Generate human-readable description
function describeCron(cron: string): string {
  const { minute, hour, dayOfMonth, month, dayOfWeek } = parseCron(cron);

  // Check for presets first
  const preset = PRESETS.find(p => p.cron === cron);
  if (preset) return preset.description;

  const parts: string[] = [];

  // Time
  if (minute === "*" && hour === "*") {
    parts.push("Every minute");
  } else if (minute.startsWith("*/")) {
    parts.push(`Every ${minute.slice(2)} minutes`);
  } else if (hour === "*") {
    parts.push(`At minute ${minute} of every hour`);
  } else if (hour.includes(",")) {
    const hours = hour.split(",").map(h => `${h}:${minute.padStart(2, "0")}`);
    parts.push(`At ${hours.join(", ")}`);
  } else {
    parts.push(`At ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`);
  }

  // Day of week
  if (dayOfWeek !== "*") {
    if (dayOfWeek === "1-5") {
      parts.push("Monday through Friday");
    } else if (dayOfWeek.includes(",")) {
      const days = dayOfWeek
        .split(",")
        .map(d => DAYS_OF_WEEK[parseInt(d)]?.label)
        .filter(Boolean);
      parts.push(`on ${days.join(", ")}`);
    } else if (dayOfWeek.includes("-")) {
      const [start, end] = dayOfWeek.split("-").map(d => DAYS_OF_WEEK[parseInt(d)]?.label);
      parts.push(`${start} through ${end}`);
    } else {
      parts.push(`on ${DAYS_OF_WEEK[parseInt(dayOfWeek)]?.label || dayOfWeek}`);
    }
  }

  // Day of month
  if (dayOfMonth !== "*") {
    if (dayOfMonth.includes(",")) {
      parts.push(`on day ${dayOfMonth} of the month`);
    } else {
      const suffix = dayOfMonth === "1" ? "st" : dayOfMonth === "2" ? "nd" : dayOfMonth === "3" ? "rd" : "th";
      parts.push(`on the ${dayOfMonth}${suffix}`);
    }
  }

  // Month
  if (month !== "*") {
    if (month.includes(",")) {
      const months = month
        .split(",")
        .map(m => MONTHS[parseInt(m) - 1]?.label)
        .filter(Boolean);
      parts.push(`in ${months.join(", ")}`);
    } else {
      parts.push(`in ${MONTHS[parseInt(month) - 1]?.label || month}`);
    }
  }

  return parts.join(", ") || "Custom schedule";
}

// Calculate next execution time
function getNextExecution(cron: string): Date | null {
  try {
    const { minute, hour } = parseCron(cron);
    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0);
    next.setMilliseconds(0);

    // Every minute pattern
    if (minute === "*" && hour === "*") {
      next.setMinutes(next.getMinutes() + 1);
      return next;
    }

    // Every N minutes pattern (*/5, */15, etc)
    if (minute.startsWith("*/")) {
      const interval = parseInt(minute.slice(2));
      const currentMinute = now.getMinutes();
      const nextMinute = Math.ceil((currentMinute + 1) / interval) * interval;
      if (nextMinute >= 60) {
        next.setHours(next.getHours() + 1);
        next.setMinutes(0);
      } else {
        next.setMinutes(nextMinute);
      }
      return next;
    }

    // Specific minute
    if (minute !== "*" && !minute.includes("/") && !minute.includes(",")) {
      next.setMinutes(parseInt(minute));
    }

    // Specific hour
    if (hour !== "*" && !hour.includes("/") && !hour.includes(",")) {
      next.setHours(parseInt(hour));
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
    } else if (minute !== "*" && hour === "*") {
      // Every hour at specific minute
      if (now.getMinutes() >= parseInt(minute)) {
        next.setHours(next.getHours() + 1);
      }
    }

    return next > now ? next : null;
  } catch {
    return null;
  }
}

// Multi-select dropdown component
function MultiSelect({
  options,
  value,
  onChange,
  label,
  allowAll = true,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  allowAll?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedValues = value === "*" ? [] : value.split(",");

  const handleToggle = (optionValue: string) => {
    if (value === "*") {
      onChange(optionValue);
    } else {
      const current = new Set(selectedValues);
      if (current.has(optionValue)) {
        current.delete(optionValue);
        onChange(current.size === 0 ? "*" : Array.from(current).join(","));
      } else {
        current.add(optionValue);
        onChange(
          Array.from(current)
            .sort((a, b) => parseInt(a) - parseInt(b))
            .join(",")
        );
      }
    }
  };

  const displayValue =
    value === "*"
      ? `Any ${label.toLowerCase()}`
      : selectedValues.length > 2
        ? `${selectedValues.length} selected`
        : selectedValues.map(v => options.find(o => o.value === v)?.label || v).join(", ");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center justify-between w-full px-2 py-1.5 text-xs rounded border",
          "[.theme-classic_&]:bg-white [.theme-classic_&]:border-black [.theme-classic_&]:text-black",
          "[.theme-inverted_&]:bg-gray-900 [.theme-inverted_&]:border-white [.theme-inverted_&]:text-white",
          "[.theme-classic_&]:hover:bg-black/5 [.theme-inverted_&]:hover:bg-white/10"
        )}
      >
        <span className="truncate">{displayValue}</span>
        <ChevronDown className={cn("w-3 h-3 ml-1 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            className={cn(
              "absolute z-50 mt-1 w-full max-h-40 overflow-auto rounded border shadow-lg",
              "[.theme-classic_&]:bg-white [.theme-classic_&]:border-black",
              "[.theme-inverted_&]:bg-gray-900 [.theme-inverted_&]:border-white"
            )}
          >
            {allowAll && (
              <button
                type="button"
                onClick={() => {
                  onChange("*");
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full px-2 py-1.5 text-left text-xs",
                  value === "*"
                    ? "[.theme-classic_&]:bg-black [.theme-classic_&]:text-white [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black"
                    : "",
                  "[.theme-classic_&]:hover:bg-black/10",
                  "[.theme-inverted_&]:hover:bg-white/10"
                )}
              >
                Any {label.toLowerCase()}
              </button>
            )}
            {options.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleToggle(option.value)}
                className={cn(
                  "w-full px-2 py-1.5 text-left text-xs flex items-center justify-between",
                  selectedValues.includes(option.value)
                    ? "[.theme-classic_&]:bg-black/10 [.theme-inverted_&]:bg-white/10"
                    : "",
                  "[.theme-classic_&]:hover:bg-black/5",
                  "[.theme-inverted_&]:hover:bg-white/5"
                )}
              >
                <span>{option.label}</span>
                {selectedValues.includes(option.value) && (
                  <span className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white">✓</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function CronBuilder({ value, onChange, className }: CronBuilderProps) {
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [customCron, setCustomCron] = useState(value);
  const parsed = parseCron(value);

  // Check if current value matches a preset
  const matchingPreset = useMemo(() => PRESETS.find(p => p.cron === value), [value]);

  useEffect(() => {
    if (matchingPreset) {
      setMode("preset");
    }
  }, [matchingPreset]);

  const handleFieldChange = (field: keyof ReturnType<typeof parseCron>, newValue: string) => {
    const current = parseCron(value);
    current[field] = newValue;
    const newCron = `${current.minute} ${current.hour} ${current.dayOfMonth} ${current.month} ${current.dayOfWeek}`;
    onChange(newCron);
    setCustomCron(newCron);
  };

  const handlePresetSelect = (preset: (typeof PRESETS)[number]) => {
    onChange(preset.cron);
    setCustomCron(preset.cron);
  };

  const description = describeCron(value);
  const nextExecution = getNextExecution(value);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Mode Toggle */}
      <div className={cn("flex rounded border", "[.theme-classic_&]:border-black", "[.theme-inverted_&]:border-white")}>
        <button
          type="button"
          onClick={() => setMode("preset")}
          className={cn(
            "flex-1 py-1.5 px-3 text-xs font-medium transition-colors",
            mode === "preset"
              ? "[.theme-classic_&]:bg-black [.theme-classic_&]:text-white [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black"
              : "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white"
          )}
        >
          Quick Select
        </button>
        <button
          type="button"
          onClick={() => setMode("custom")}
          className={cn(
            "flex-1 py-1.5 px-3 text-xs font-medium transition-colors border-l",
            "[.theme-classic_&]:border-black [.theme-inverted_&]:border-white",
            mode === "custom"
              ? "[.theme-classic_&]:bg-black [.theme-classic_&]:text-white [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black"
              : "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white"
          )}
        >
          Custom
        </button>
      </div>

      {/* Preset Selection */}
      {mode === "preset" && (
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map(preset => (
            <button
              key={preset.cron}
              type="button"
              onClick={() => handlePresetSelect(preset)}
              className={cn(
                "p-2 text-left rounded border transition-all",
                value === preset.cron
                  ? "[.theme-classic_&]:border-black [.theme-classic_&]:bg-black/10 [.theme-inverted_&]:border-white [.theme-inverted_&]:bg-white/10"
                  : "[.theme-classic_&]:border-black/30 [.theme-classic_&]:hover:border-black [.theme-inverted_&]:border-white/30 [.theme-inverted_&]:hover:border-white"
              )}
            >
              <div
                className={cn("font-medium text-xs", "[.theme-classic_&]:text-black", "[.theme-inverted_&]:text-white")}
              >
                {preset.label}
              </div>
              <div
                className={cn(
                  "text-xs mt-0.5",
                  "[.theme-classic_&]:text-black/60",
                  "[.theme-inverted_&]:text-white/60"
                )}
              >
                {preset.description}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Custom Cron Builder */}
      {mode === "custom" && (
        <div className="space-y-3">
          {/* Visual Builder */}
          <div className="grid grid-cols-5 gap-1.5">
            <div>
              <label
                className={cn(
                  "block text-xs font-medium mb-1",
                  "[.theme-classic_&]:text-black",
                  "[.theme-inverted_&]:text-white"
                )}
              >
                Minute
              </label>
              <MultiSelect
                options={MINUTES}
                value={parsed.minute}
                onChange={v => handleFieldChange("minute", v)}
                label="Minute"
              />
            </div>
            <div>
              <label
                className={cn(
                  "block text-xs font-medium mb-1",
                  "[.theme-classic_&]:text-black",
                  "[.theme-inverted_&]:text-white"
                )}
              >
                Hour
              </label>
              <MultiSelect
                options={HOURS}
                value={parsed.hour}
                onChange={v => handleFieldChange("hour", v)}
                label="Hour"
              />
            </div>
            <div>
              <label
                className={cn(
                  "block text-xs font-medium mb-1",
                  "[.theme-classic_&]:text-black",
                  "[.theme-inverted_&]:text-white"
                )}
              >
                Day
              </label>
              <MultiSelect
                options={DAYS_OF_MONTH}
                value={parsed.dayOfMonth}
                onChange={v => handleFieldChange("dayOfMonth", v)}
                label="Day"
              />
            </div>
            <div>
              <label
                className={cn(
                  "block text-xs font-medium mb-1",
                  "[.theme-classic_&]:text-black",
                  "[.theme-inverted_&]:text-white"
                )}
              >
                Month
              </label>
              <MultiSelect
                options={MONTHS}
                value={parsed.month}
                onChange={v => handleFieldChange("month", v)}
                label="Month"
              />
            </div>
            <div>
              <label
                className={cn(
                  "block text-xs font-medium mb-1",
                  "[.theme-classic_&]:text-black",
                  "[.theme-inverted_&]:text-white"
                )}
              >
                Weekday
              </label>
              <MultiSelect
                options={DAYS_OF_WEEK}
                value={parsed.dayOfWeek}
                onChange={v => handleFieldChange("dayOfWeek", v)}
                label="Weekday"
              />
            </div>
          </div>

          {/* Raw Cron Input */}
          <div>
            <label
              className={cn(
                "block text-xs font-medium mb-1",
                "[.theme-classic_&]:text-black",
                "[.theme-inverted_&]:text-white"
              )}
            >
              Cron Expression
            </label>
            <input
              type="text"
              value={customCron}
              onChange={e => {
                setCustomCron(e.target.value);
                if (e.target.value.split(" ").length === 5) {
                  onChange(e.target.value);
                }
              }}
              placeholder="* * * * *"
              className={cn(
                "w-full px-2 py-1.5 text-xs font-mono rounded border",
                "[.theme-classic_&]:bg-white [.theme-classic_&]:border-black [.theme-classic_&]:text-black",
                "[.theme-inverted_&]:bg-gray-900 [.theme-inverted_&]:border-white [.theme-inverted_&]:text-white",
                "focus:outline-none focus:ring-1 [.theme-classic_&]:focus:ring-black [.theme-inverted_&]:focus:ring-white"
              )}
            />
          </div>
        </div>
      )}

      {/* Schedule Preview */}
      <div className={cn("p-3 rounded border", "[.theme-classic_&]:border-black", "[.theme-inverted_&]:border-white")}>
        <div className={cn("font-medium text-sm", "[.theme-classic_&]:text-black", "[.theme-inverted_&]:text-white")}>
          {description}
        </div>
        {nextExecution && (
          <div className={cn("text-xs mt-1", "[.theme-classic_&]:text-black/70", "[.theme-inverted_&]:text-white/70")}>
            Next run: {nextExecution.toLocaleString()}
          </div>
        )}
      </div>

      {/* Help Text */}
      <div className={cn("text-xs", "[.theme-classic_&]:text-black/60", "[.theme-inverted_&]:text-white/60")}>
        Format: minute, hour, day, month, weekday. Use * for any, */n for every n.
      </div>
    </div>
  );
}

export { describeCron, getNextExecution, parseCron };
