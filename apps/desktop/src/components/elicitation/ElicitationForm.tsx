/**
 * ElicitationForm Component
 *
 * Dynamic form renderer based on JSON Schema.
 */

import React, { useCallback, useMemo, useState } from "react";
import { ElicitationRequest, FormFieldConfig } from "@/lib/elicitation/types";
import { schemaToFields, validateForm, analyzeSchema } from "@/lib/elicitation/schema-to-fields";
import { FormField } from "./FormField";
import { QuickActionChips } from "./QuickActionChips";
import { ShortcutHint } from "./ShortcutHint";
import { useShortcuts } from "@/hooks/useShortcuts";
import { shouldShowQuickActions } from "@/lib/elicitation/infer-question-type";
import { SHORTCUTS } from "@/lib/elicitation/constants";

interface ElicitationFormProps {
  request: ElicitationRequest;
  onSubmit: (values: Record<string, unknown>) => void;
  onSkip: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function ElicitationForm({ request, onSubmit, onSkip, onCancel, disabled }: ElicitationFormProps) {
  // Parse schema into fields
  const fields = useMemo(() => schemaToFields(request.requestedSchema), [request.requestedSchema]);

  // Analyze schema structure
  const schemaAnalysis = useMemo(() => analyzeSchema(request.requestedSchema), [request.requestedSchema]);

  // Initialize form values with defaults/suggestions
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};

    // Use AI suggestion if available
    if (request.suggestion?.value) {
      Object.assign(initial, request.suggestion.value);
    }

    // Fill in defaults for missing fields
    for (const field of fields) {
      if (initial[field.key] === undefined && field.property.default !== undefined) {
        initial[field.key] = field.property.default;
      }
    }

    return initial;
  });

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());

  // Handle field change
  const handleChange = useCallback((key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setTouched(prev => new Set(prev).add(key));
    // Clear error when user changes value
    setErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Handle form submission
  const handleSubmit = useCallback(() => {
    const validationErrors = validateForm(values, fields);

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setTouched(new Set(fields.map(f => f.key)));
      return;
    }

    onSubmit(values);
  }, [values, fields, onSubmit]);

  // Handle option selection (for single enum fields)
  const handleOptionSelect = useCallback(
    (index: number) => {
      // Find the first enum field
      const enumField = fields.find(f => f.property.enum && f.property.enum.length > 0);
      if (enumField && enumField.property.enum && index < enumField.property.enum.length) {
        const option = enumField.property.enum[index];
        handleChange(enumField.key, option);

        // Auto-submit if single enum field
        if (schemaAnalysis.isSingleEnum) {
          setTimeout(() => {
            onSubmit({ [enumField.key]: option });
          }, 150); // Brief delay for visual feedback
        }
      }
    },
    [fields, handleChange, onSubmit, schemaAnalysis.isSingleEnum]
  );

  // Keyboard shortcuts
  useShortcuts({
    enabled: !disabled,
    onOptionSelect: handleOptionSelect,
    onSubmit: handleSubmit,
    onSkip,
    onCancel,
  });

  // Should show quick actions?
  const showQuickActions = shouldShowQuickActions(request);

  return (
    <div className="space-y-4">
      {/* Form fields */}
      <div className="space-y-4">
        {fields.map((field, index) => (
          <FormField
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={value => handleChange(field.key, value)}
            error={touched.has(field.key) ? errors[field.key] : undefined}
            recommendedValue={request.suggestion?.value?.[field.key]}
            disabled={disabled}
            autoFocus={index === 0}
          />
        ))}
      </div>

      {/* Quick actions for error recovery */}
      {showQuickActions && (
        <div className="pt-2 border-t border-neutral-200 dark:border-neutral-700">
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-2">Quick actions:</p>
          <QuickActionChips onRetry={() => onSubmit({ _action: "retry" })} onSkip={onSkip} disabled={disabled} />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-neutral-200 dark:border-neutral-700">
        <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <ShortcutHint shortcut={SHORTCUTS.SKIP} />
          <span>to skip</span>
          <span className="mx-1">·</span>
          <ShortcutHint shortcut={SHORTCUTS.CANCEL} />
          <span>to cancel</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSkip}
            disabled={disabled}
            className="
              px-4 py-2 rounded-lg
              text-neutral-600 dark:text-neutral-400
              hover:bg-neutral-100 dark:hover:bg-neutral-800
              transition-colors duration-150
              disabled:opacity-50 disabled:cursor-not-allowed
              text-sm font-medium
            "
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={disabled}
            className="
              inline-flex items-center gap-2
              px-4 py-2 rounded-lg
              bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100
              text-white dark:text-neutral-900 font-medium text-sm
              transition-colors duration-150
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            Submit
            <ShortcutHint
              shortcut={SHORTCUTS.SUBMIT}
              className="bg-neutral-700/30 border-neutral-600/50 text-neutral-300 dark:bg-neutral-300/30 dark:border-neutral-400/50 dark:text-neutral-600"
            />
          </button>
        </div>
      </div>
    </div>
  );
}
