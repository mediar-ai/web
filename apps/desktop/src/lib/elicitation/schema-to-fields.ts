/**
 * Schema to Fields Converter
 *
 * Converts JSON Schema to form field configurations.
 */

import { SHORTCUTS } from "./constants";
import { ElicitationSchema, FormFieldConfig, JsonSchemaProperty } from "./types";

/**
 * Convert a JSON Schema to an array of form field configurations.
 */
export function schemaToFields(schema: ElicitationSchema): FormFieldConfig[] {
  const { properties, required = [] } = schema;
  const fields: FormFieldConfig[] = [];

  let enumIndex = 0;

  for (const [key, property] of Object.entries(properties)) {
    const field: FormFieldConfig = {
      key,
      property,
      required: required.includes(key),
    };

    // Assign number shortcuts to enum options
    if (property.enum && enumIndex < SHORTCUTS.OPTION_KEYS.length) {
      field.shortcut = SHORTCUTS.OPTION_KEYS[enumIndex];
      enumIndex++;
    }

    fields.push(field);
  }

  return fields;
}

/**
 * Get the display label for a field.
 * Prioritizes: title > description > key (humanized)
 */
export function getFieldLabel(property: JsonSchemaProperty, key: string): string {
  if (property.title) return property.title;
  if (property.description) return property.description;
  return humanizeKey(key);
}

/**
 * Convert a camelCase or snake_case key to human-readable text.
 */
export function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Get the default value for a field based on its type.
 */
export function getDefaultValue(property: JsonSchemaProperty): unknown {
  if (property.default !== undefined) return property.default;

  switch (property.type) {
    case "string":
      return "";
    case "number":
    case "integer":
      return property.minimum ?? 0;
    case "boolean":
      return false;
    default:
      return "";
  }
}

/**
 * Validate a value against a property schema.
 * Returns an error message or null if valid.
 */
export function validateField(value: unknown, property: JsonSchemaProperty, required: boolean): string | null {
  // Required check
  if (required && (value === undefined || value === null || value === "")) {
    return "This field is required";
  }

  // Skip further validation if empty and not required
  if (value === undefined || value === null || value === "") {
    return null;
  }

  // Type-specific validation
  switch (property.type) {
    case "string":
      if (typeof value !== "string") {
        return "Must be text";
      }
      if (property.enum && !property.enum.includes(value)) {
        return `Must be one of: ${property.enum.join(", ")}`;
      }
      break;

    case "number":
    case "integer":
      const num = typeof value === "string" ? parseFloat(value) : value;
      if (typeof num !== "number" || isNaN(num)) {
        return "Must be a number";
      }
      if (property.type === "integer" && !Number.isInteger(num)) {
        return "Must be a whole number";
      }
      if (property.minimum !== undefined && num < property.minimum) {
        return `Must be at least ${property.minimum}`;
      }
      if (property.maximum !== undefined && num > property.maximum) {
        return `Must be at most ${property.maximum}`;
      }
      break;

    case "boolean":
      if (typeof value !== "boolean") {
        return "Must be true or false";
      }
      break;
  }

  return null;
}

/**
 * Check if all fields in a form are valid.
 */
export function validateForm(values: Record<string, unknown>, fields: FormFieldConfig[]): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const error = validateField(values[field.key], field.property, field.required);
    if (error) {
      errors[field.key] = error;
    }
  }

  return errors;
}

/**
 * Count how many fields are enum (single selection) vs free input.
 */
export function analyzeSchema(schema: ElicitationSchema): {
  enumCount: number;
  inputCount: number;
  totalCount: number;
  isSingleEnum: boolean;
} {
  const properties = Object.values(schema.properties);
  const enumCount = properties.filter(p => p.enum && p.enum.length > 0).length;
  const inputCount = properties.length - enumCount;

  return {
    enumCount,
    inputCount,
    totalCount: properties.length,
    isSingleEnum: enumCount === 1 && inputCount === 0,
  };
}
