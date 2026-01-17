/**
 * FormField Component
 *
 * Renders a form field based on JSON Schema property type.
 */

import React from "react";
import { FormFieldConfig } from "@/lib/elicitation/types";
import { getFieldLabel } from "@/lib/elicitation/schema-to-fields";
import { OptionCard } from "./OptionCard";
import { ShortcutHint } from "./ShortcutHint";
import { SHORTCUTS } from "@/lib/elicitation/constants";

interface FormFieldProps {
  /** Field configuration from schema */
  field: FormFieldConfig;
  /** Current value */
  value: unknown;
  /** Callback when value changes */
  onChange: (value: unknown) => void;
  /** Error message */
  error?: string;
  /** AI-recommended value */
  recommendedValue?: unknown;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Auto-focus this field */
  autoFocus?: boolean;
}

export function FormField({ field, value, onChange, error, recommendedValue, disabled, autoFocus }: FormFieldProps) {
  const { key, property, required } = field;
  const label = getFieldLabel(property, key);

  // Enum field - render as option cards
  if (property.enum && property.enum.length > 0) {
    return (
      <div className="space-y-2">
        <Label label={label} required={required} />
        <div className="space-y-2">
          {property.enum.map((option, index) => {
            const enumName = property.enumNames?.[index] || option;
            const shortcut = index < SHORTCUTS.OPTION_KEYS.length ? SHORTCUTS.OPTION_KEYS[index] : undefined;

            return (
              <OptionCard
                key={option}
                value={option}
                label={enumName}
                selected={value === option}
                recommended={recommendedValue === option}
                shortcut={shortcut}
                onSelect={() => onChange(option)}
                disabled={disabled}
              />
            );
          })}
        </div>
        {error && <ErrorMessage message={error} />}
      </div>
    );
  }

  // Boolean field - render as checkbox
  if (property.type === "boolean") {
    return (
      <div className="space-y-1">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={e => onChange(e.target.checked)}
            disabled={disabled}
            className="
              w-5 h-5 rounded border-2
              border-neutral-300 dark:border-neutral-600
              text-neutral-900 dark:text-white focus:ring-neutral-500
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          />
          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {label}
            {required && <RequiredIndicator />}
          </span>
        </label>
        {property.description && (
          <p className="ml-8 text-sm text-neutral-500 dark:text-neutral-400">{property.description}</p>
        )}
        {error && <ErrorMessage message={error} />}
      </div>
    );
  }

  // Number field
  if (property.type === "number" || property.type === "integer") {
    return (
      <div className="space-y-1">
        <Label label={label} required={required} />
        <input
          type="number"
          value={(value as number) ?? ""}
          onChange={e => {
            const val = e.target.value;
            if (val === "") {
              onChange(undefined);
            } else {
              onChange(property.type === "integer" ? parseInt(val, 10) : parseFloat(val));
            }
          }}
          min={property.minimum}
          max={property.maximum}
          step={property.type === "integer" ? 1 : "any"}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={property.description}
          className={`
            w-full px-3 py-2 rounded-lg
            border-2 transition-colors
            bg-white dark:bg-neutral-900
            text-neutral-900 dark:text-neutral-100
            placeholder:text-neutral-400 dark:placeholder:text-neutral-500
            ${
              error
                ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                : "border-neutral-200 dark:border-neutral-700 focus:border-neutral-900 dark:focus:border-white focus:ring-neutral-500/20"
            }
            focus:outline-none focus:ring-2
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        />
        {property.description && !error && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{property.description}</p>
        )}
        {error && <ErrorMessage message={error} />}
      </div>
    );
  }

  // Default: string field
  return (
    <div className="space-y-1">
      <Label label={label} required={required} />
      <input
        type="text"
        value={(value as string) ?? ""}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={property.description}
        className={`
          w-full px-3 py-2 rounded-lg
          border-2 transition-colors
          bg-white dark:bg-neutral-900
          text-neutral-900 dark:text-neutral-100
          placeholder:text-neutral-400 dark:placeholder:text-neutral-500
          ${
            error
              ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
              : "border-neutral-200 dark:border-neutral-700 focus:border-neutral-900 dark:focus:border-white focus:ring-neutral-500/20"
          }
          focus:outline-none focus:ring-2
          disabled:opacity-50 disabled:cursor-not-allowed
        `}
      />
      {property.description && !error && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{property.description}</p>
      )}
      {error && <ErrorMessage message={error} />}
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function Label({ label, required }: { label: string; required: boolean }) {
  return (
    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
      {label}
      {required && <RequiredIndicator />}
    </label>
  );
}

function RequiredIndicator() {
  return <span className="ml-1 text-red-500">*</span>;
}

function ErrorMessage({ message }: { message: string }) {
  return <p className="text-sm text-red-500 dark:text-red-400">{message}</p>;
}
