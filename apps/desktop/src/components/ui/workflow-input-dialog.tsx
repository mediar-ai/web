import { Loader2, Play, X } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ParsedInputField } from "@/lib/typescript-workflow-parser";

interface WorkflowInputDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (inputs: Record<string, unknown>) => void | Promise<void>;
  inputs: ParsedInputField[];
  workflowId: string;
  workflowName: string;
  isLoading?: boolean;
}

const STORAGE_KEY_PREFIX = "workflow-inputs-";

function getStoredInputs(workflowId: string): Record<string, unknown> {
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${workflowId}`);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveInputs(workflowId: string, inputs: Record<string, unknown>) {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${workflowId}`, JSON.stringify(inputs));
  } catch (e) {
    console.warn("[WorkflowInputDialog] Failed to save inputs to localStorage:", e);
  }
}

export function WorkflowInputDialog({
  isOpen,
  onClose,
  onConfirm,
  inputs,
  workflowId,
  workflowName,
  isLoading = false,
}: WorkflowInputDialogProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());

  // Initialize values when dialog opens
  useEffect(() => {
    if (isOpen) {
      // Load stored values and merge with defaults
      const stored = getStoredInputs(workflowId);
      const initialValues: Record<string, unknown> = {};

      for (const field of inputs) {
        // Priority: stored value > default value > empty
        if (stored[field.name] !== undefined) {
          initialValues[field.name] = stored[field.name];
        } else if (field.defaultValue !== undefined) {
          initialValues[field.name] = field.defaultValue;
        } else if (field.type === "boolean") {
          initialValues[field.name] = false;
        } else if (field.type === "number") {
          initialValues[field.name] = "";
        } else {
          initialValues[field.name] = "";
        }
      }

      setValues(initialValues);
      setErrors({});
      setTouched(new Set());
    }
  }, [isOpen, workflowId, inputs]);

  const handleChange = useCallback((name: string, value: unknown) => {
    setValues(prev => ({ ...prev, [name]: value }));
    setTouched(prev => new Set(prev).add(name));
    // Clear error when user modifies field
    setErrors(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    for (const field of inputs) {
      const value = values[field.name];

      if (field.required) {
        if (value === undefined || value === null || value === "") {
          newErrors[field.name] = "Required";
        }
      }

      // Type-specific validation
      if (field.type === "number" && value !== "" && value !== undefined) {
        const num = Number(value);
        if (isNaN(num)) {
          newErrors[field.name] = "Must be a number";
        }
      }
    }

    setErrors(newErrors);
    setTouched(new Set(inputs.map(f => f.name)));
    return Object.keys(newErrors).length === 0;
  }, [inputs, values]);

  const handleConfirm = async () => {
    if (!validate()) {
      return;
    }

    // Convert values to proper types
    const typedValues: Record<string, unknown> = {};
    for (const field of inputs) {
      const value = values[field.name];
      if (field.type === "number" && value !== "" && value !== undefined) {
        typedValues[field.name] = Number(value);
      } else if (field.type === "boolean") {
        typedValues[field.name] = Boolean(value);
      } else {
        typedValues[field.name] = value;
      }
    }

    // Save inputs for next time
    saveInputs(workflowId, typedValues);

    await onConfirm(typedValues);
  };

  const handleCancel = () => {
    if (!isLoading) {
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isLoading) {
      handleCancel();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !isLoading) {
      e.preventDefault();
      handleCancel();
    }
  };

  const renderField = (field: ParsedInputField) => {
    const value = values[field.name];
    const error = touched.has(field.name) ? errors[field.name] : undefined;
    const fieldId = `input-${field.name}`;

    // Boolean field - render as switch
    if (field.type === "boolean") {
      return (
        <div key={field.name} className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor={fieldId} className={cn("[.theme-classic_&]:text-black [.theme-inverted_&]:text-white")}>
                {field.name}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
            </div>
            <Switch
              id={fieldId}
              checked={Boolean(value)}
              onCheckedChange={checked => handleChange(field.name, checked)}
              disabled={isLoading}
            />
          </div>
        </div>
      );
    }

    // Enum field - render as select
    if (field.type === "enum" && field.enumValues) {
      return (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={fieldId} className={cn("[.theme-classic_&]:text-black [.theme-inverted_&]:text-white")}>
            {field.name}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </Label>
          <select
            id={fieldId}
            value={String(value ?? "")}
            onChange={e => handleChange(field.name, e.target.value)}
            disabled={isLoading}
            className={cn(
              "flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "[.theme-classic_&]:border-input [.theme-classic_&]:text-black",
              "[.theme-inverted_&]:border-white/20 [.theme-inverted_&]:text-white [.theme-inverted_&]:bg-gray-800",
              error && "border-red-500 focus-visible:ring-red-500"
            )}
          >
            <option value="">Select...</option>
            {field.enumValues.map(opt => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      );
    }

    // Number or string field
    return (
      <div key={field.name} className="space-y-2">
        <Label htmlFor={fieldId} className={cn("[.theme-classic_&]:text-black [.theme-inverted_&]:text-white")}>
          {field.name}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </Label>
        <Input
          id={fieldId}
          type={field.type === "number" ? "number" : "text"}
          value={String(value ?? "")}
          onChange={e => handleChange(field.name, e.target.value)}
          disabled={isLoading}
          placeholder={field.description || `Enter ${field.name}...`}
          className={cn(
            "[.theme-classic_&]:border-input [.theme-inverted_&]:border-white/20",
            error && "border-red-500 focus-visible:ring-red-500"
          )}
        />
        {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  };

  if (!isOpen) return null;

  const hasErrors = Object.keys(errors).length > 0;
  const requiredFieldsMissing = inputs.some(
    f => f.required && (values[f.name] === undefined || values[f.name] === null || values[f.name] === "")
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className={cn(
          "w-full max-w-lg max-h-[85vh] flex flex-col rounded-lg shadow-lg border",
          "[.theme-classic_&]:bg-white [.theme-classic_&]:border-black",
          "[.theme-inverted_&]:bg-gray-900 [.theme-inverted_&]:border-white"
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={cn(
            "flex items-center justify-between p-4 border-b flex-shrink-0",
            "[.theme-classic_&]:border-black",
            "[.theme-inverted_&]:border-white"
          )}
        >
          <div>
            <h2 className={cn("text-lg font-semibold", "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white")}>
              Workflow Inputs
            </h2>
            <p className="text-sm text-muted-foreground">{workflowName}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleCancel} disabled={isLoading} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body - scrollable */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            <p className={cn("text-sm", "[.theme-classic_&]:text-black/70 [.theme-inverted_&]:text-white/70")}>
              Fill in the required inputs to run this workflow. Your values will be saved for next time.
            </p>
            <div className="space-y-4">{inputs.map(renderField)}</div>
          </div>
        </ScrollArea>

        {/* Footer */}
        <div
          className={cn(
            "flex items-center justify-end gap-2 p-4 border-t flex-shrink-0",
            "[.theme-classic_&]:border-black",
            "[.theme-inverted_&]:border-white"
          )}
        >
          <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading || hasErrors || requiredFieldsMissing}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Run Workflow
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
