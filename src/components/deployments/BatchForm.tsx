'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CornerDownLeft, X, Key, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import '@/styles/custom-scrollbar.css';

interface Secret {
  id: string;
  name: string;
  description: string | null;
}

type JsonValue =
  | string
  | number
  | boolean
  | { [x: string]: JsonValue }
  | Array<JsonValue>
  | null;
type JsonObject = { [x: string]: JsonValue };

interface SchemaItem {
  type?: string;
  label?: string;
  description?: string;
  default?: JsonValue;
  regex?: string;
  validation_message?: string;
  options?: Array<{ value: string; label: string }>;
  controls?: Record<string, Record<string, SchemaItem>>;
  value_type?: string; // For nested object values (e.g., 'select' if value_schema is enum)
  value_options?: string[]; // For nested object value enum options
  properties?: Record<string, SchemaItem>; // For objects with known structure
  item_schema?: SchemaItem; // For arrays with typed items
  value_schema?: SchemaItem; // For objects with uniform value types
}

interface BatchFormProps {
  schema: JsonObject;
  initialValues: JsonObject;
  onSpecChange: (
    spec: {
      static_parameters: JsonObject;
      dynamic_parameters: Record<string, JsonValue[]>;
    },
    isValid: boolean
  ) => void;
  onCombinationsChange: (count: number) => void;
  initialSpec?: {
    static_parameters: JsonObject;
    dynamic_parameters: Record<string, JsonValue[]>;
  };
}

function flattenSchema(
  schema: JsonObject,
  path = '',
  acc: Record<string, SchemaItem> = {}
): Record<string, SchemaItem> {
  for (const key in schema) {
    const newPath = path ? `${path}.${key}` : key;
    const value = schema[key] as JsonObject;
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !value.type
    ) {
      flattenSchema(value, newPath, acc);
    } else {
      acc[newPath] = value as SchemaItem;
    }
  }
  return acc;
}

const CheckboxListField = ({
  options,
  selectedValues,
  onToggle,
  disabled = false,
}: {
  options: Array<{ value: string; label: string }>;
  selectedValues: JsonValue[];
  onToggle: (value: string, checked: boolean) => void;
  disabled?: boolean;
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const filteredOptions = options.filter(opt =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectAll = () => {
    options.forEach(option => {
      const isSelected = selectedValues.some(v => String(v) === option.value);
      if (!isSelected) {
        onToggle(option.value, true);
      }
    });
  };

  const handleDeselectAll = () => {
    selectedValues.forEach(value => {
      onToggle(String(value), false);
    });
  };

  return (
    <div className="w-56">
      <Input
        placeholder="Search options..."
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        className="mb-1.5 h-6 text-xs border-black"
        disabled={disabled}
      />
      <div className="max-h-48 overflow-y-auto custom-scrollbar border border-black rounded p-1.5 bg-gray-50">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs text-gray-600 font-medium">
            {selectedValues.length} of {options.length} selected
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSelectAll}
              disabled={disabled || selectedValues.length === options.length}
              className="h-5 px-1.5 text-xs border-black hover:bg-gray-100"
            >
              All
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDeselectAll}
              disabled={disabled || selectedValues.length === 0}
              className="h-5 px-1.5 text-xs border-black hover:bg-gray-100"
            >
              None
            </Button>
          </div>
        </div>
        {filteredOptions.length > 0 ? (
          filteredOptions.map(option => {
            const isSelected = selectedValues.some(
              v => String(v) === option.value
            );
            return (
              <label
                key={option.value}
                className="flex items-center gap-1.5 p-0.5 hover:bg-gray-100 cursor-pointer text-xs rounded"
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={e => onToggle(option.value, e.target.checked)}
                  disabled={disabled}
                  className="h-3 w-3"
                />
                <span className={isSelected ? 'font-medium' : ''}>
                  {option.label}
                </span>
              </label>
            );
          })
        ) : (
          <div className="text-xs text-gray-500 p-1.5 text-center">
            {searchTerm
              ? 'No options match your search'
              : 'No options available'}
          </div>
        )}
      </div>
    </div>
  );
};

// Helper function to check if an object is a flat key-value structure
const isFlatKeyValue = (obj: any): boolean => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;

  return Object.values(obj).every(val =>
    typeof val === 'string' ||
    typeof val === 'number' ||
    typeof val === 'boolean' ||
    val === null
  );
};

// Component for arrays with item_schema (typed array items)
const ArrayField = ({
  label,
  path,
  value,
  onChange,
  schema,
  error,
  disabled = false,
}: {
  label: string;
  path: string;
  value: JsonValue;
  onChange: (path: string, value: JsonValue) => void;
  schema: SchemaItem;
  error?: string;
  disabled?: boolean;
}) => {
  const currentValue = (value || schema.default || []) as JsonValue[];

  const handleAddItem = () => {
    const newItem = schema.item_schema?.default || {};
    onChange(path, [...currentValue, newItem]);
  };

  const handleRemoveItem = (index: number) => {
    const updated = currentValue.filter((_, i) => i !== index);
    onChange(path, updated);
  };

  const handleItemChange = (index: number, newValue: JsonValue) => {
    const updated = [...currentValue];
    updated[index] = newValue;
    onChange(path, updated);
  };

  return (
    <div className="grid grid-cols-3 gap-2 items-start">
      <Label className="text-xs font-medium text-gray-700 pt-0.5 col-span-1">
        {label}:
      </Label>
      <div className="col-span-2 space-y-1.5">
        {schema.description && (
          <p className="text-xs text-gray-600 mb-1.5">{schema.description}</p>
        )}

        <div className="border-2 border-black bg-white rounded">
          <div className="p-2 space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
            {currentValue.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No items yet</p>
            ) : (
              currentValue.map((item, index) => (
                <div key={index} className="border border-gray-300 rounded p-1.5 bg-gray-50">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-mono font-bold">Item {index + 1}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRemoveItem(index)}
                      disabled={disabled}
                      className="h-5 w-5 p-0 border-black hover:bg-red-600 hover:text-white hover:border-red-600"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  {schema.item_schema?.properties ? (
                    <NestedObjectField
                      value={item}
                      onChange={(newVal) => handleItemChange(index, newVal)}
                      schema={schema.item_schema}
                      disabled={disabled}
                    />
                  ) : (
                    <textarea
                      className="w-full h-20 text-xs font-mono p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-black"
                      value={JSON.stringify(item, null, 2)}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          handleItemChange(index, parsed);
                        } catch {
                          // Ignore parse errors while typing
                        }
                      }}
                      disabled={disabled}
                    />
                  )}
                </div>
              ))
            )}
          </div>
          <div className="border-t border-gray-300 p-1.5">
            <Button
              size="sm"
              onClick={handleAddItem}
              disabled={disabled}
              className="h-6 px-2 text-xs bg-black text-white hover:bg-gray-800"
            >
              + Add Item
            </Button>
          </div>
        </div>
        {error && <p className="text-red-500 text-xs mt-1 font-mono">{error}</p>}
      </div>
    </div>
  );
};

// Component for nested objects with properties schema
const NestedObjectField = ({
  value,
  onChange,
  schema,
  disabled = false,
}: {
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  schema: SchemaItem;
  disabled?: boolean;
}) => {
  const currentValue = (value || {}) as JsonObject;

  const handleFieldChange = (key: string, newValue: JsonValue) => {
    onChange({ ...currentValue, [key]: newValue });
  };

  if (!schema.properties) return null;

  return (
    <div className="space-y-1.5">
      {Object.entries(schema.properties).map(([key, fieldSchema]) => (
        <div key={key} className="grid grid-cols-3 gap-1.5 items-start">
          <label className="text-xs font-mono text-gray-700 col-span-1 pt-0.5">
            {fieldSchema.label || key}:
          </label>
          <div className="col-span-2">
            {fieldSchema.description && (
              <p className="text-xs text-gray-500 mb-0.5">{fieldSchema.description}</p>
            )}
            <Input
              type="text"
              value={String(currentValue[key] || '')}
              onChange={e => handleFieldChange(key, e.target.value)}
              disabled={disabled}
              placeholder={fieldSchema.default ? String(fieldSchema.default) : ''}
              className="h-6 text-xs font-mono border-black focus:ring-2 focus:ring-black px-1.5"
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const ObjectField = ({
  label,
  path,
  value,
  onChange,
  schema,
  error,
  disabled = false,
}: {
  label: string;
  path: string;
  value: JsonValue;
  onChange: (path: string, value: JsonValue) => void;
  schema: SchemaItem;
  error?: string;
  disabled?: boolean;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | undefined>();
  const [showJsonEditor, setShowJsonEditor] = useState(false);

  const currentValue = value || schema.default || {};
  const prettyJson = JSON.stringify(currentValue, null, 2);

  // Check if this object has a structured properties schema
  const hasPropertiesSchema = schema.properties && Object.keys(schema.properties).length > 0;

  // Check if this is a flat key-value object
  const isFlat = isFlatKeyValue(currentValue);

  const handleEdit = () => {
    setJsonText(prettyJson);
    setJsonError(undefined);
    setIsEditing(true);
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(jsonText);
      onChange(path, parsed);
      setIsEditing(false);
      setJsonError(undefined);
      toast.success('Object updated successfully');
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setJsonError(undefined);
  };

  const handleReset = () => {
    onChange(path, schema.default || {});
    toast.success('Reset to default value');
  };

  // Handle individual field changes for flat objects
  const handleFieldChange = (key: string, newValue: string) => {
    const updated = { ...(currentValue as JsonObject), [key]: newValue };
    onChange(path, updated);
  };

  // Handle property changes for structured objects
  const handlePropertyChange = (key: string, newValue: JsonValue) => {
    const updated = { ...(currentValue as JsonObject), [key]: newValue };
    onChange(path, updated);
  };

  return (
    <div className="grid grid-cols-3 gap-2 items-start">
      <Label
        htmlFor={path}
        className="text-xs font-medium text-gray-700 pt-0.5 col-span-1"
      >
        {label}:
      </Label>
      <div className="col-span-2">
        {schema.description && (
          <p className="text-xs text-gray-600 mb-1.5">{schema.description}</p>
        )}

        {/* Show structured fields for objects with properties schema */}
        {hasPropertiesSchema && !showJsonEditor && !isEditing ? (
          <div className="border-2 border-black bg-white rounded">
            <div className="p-2 space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
              {Object.entries(schema.properties!).map(([key, propSchema]) => {
                const propValue = (currentValue as JsonObject)[key];

                // Render based on property type
                if (propSchema.type === 'array' && propSchema.item_schema) {
                  const currentArrayValue = (propValue || propSchema.default || []) as JsonValue[];

                  const handleAddItem = () => {
                    const newItem = propSchema.item_schema?.default || {};
                    const updated = [...currentArrayValue, newItem];
                    handlePropertyChange(key, updated);
                  };

                  const handleRemoveItem = (index: number) => {
                    const updated = currentArrayValue.filter((_, i) => i !== index);
                    handlePropertyChange(key, updated);
                  };

                  const handleItemChange = (index: number, newValue: JsonValue) => {
                    const updated = [...currentArrayValue];
                    updated[index] = newValue;
                    handlePropertyChange(key, updated);
                  };

                  return (
                    <div key={key} className="space-y-1.5">
                      <label className="text-xs font-mono font-bold text-gray-700">
                        {propSchema.label || key}:
                      </label>
                      {propSchema.description && (
                        <p className="text-xs text-gray-500 mb-1">{propSchema.description}</p>
                      )}
                      <div className="border border-gray-300 rounded bg-gray-50 p-1.5">
                        <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar mb-1.5">
                          {currentArrayValue.length === 0 ? (
                            <p className="text-xs text-gray-500 italic">No items yet</p>
                          ) : (
                            currentArrayValue.map((item, index) => (
                              <div key={index} className="border border-gray-300 rounded p-1.5 bg-white">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-xs font-mono font-bold">Item {index + 1}</span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleRemoveItem(index)}
                                    disabled={disabled}
                                    className="h-5 w-5 p-0 border-black hover:bg-red-600 hover:text-white hover:border-red-600"
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                                {propSchema.item_schema?.properties ? (
                                  <NestedObjectField
                                    value={item}
                                    onChange={(newVal) => handleItemChange(index, newVal)}
                                    schema={propSchema.item_schema}
                                    disabled={disabled}
                                  />
                                ) : (
                                  <textarea
                                    className="w-full h-20 text-xs font-mono p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-black"
                                    value={JSON.stringify(item, null, 2)}
                                    onChange={(e) => {
                                      try {
                                        const parsed = JSON.parse(e.target.value);
                                        handleItemChange(index, parsed);
                                      } catch {
                                        // Ignore parse errors while typing
                                      }
                                    }}
                                    disabled={disabled}
                                  />
                                )}
                              </div>
                            ))
                          )}
                        </div>
                        <Button
                          size="sm"
                          onClick={handleAddItem}
                          disabled={disabled}
                          className="h-6 px-2 text-xs bg-black text-white hover:bg-gray-800"
                        >
                          + Add Item
                        </Button>
                      </div>
                    </div>
                  );
                } else if (propSchema.type === 'object' && propSchema.value_schema) {
                  // Handle nested objects with value_schema (like business_to_company)
                  const nestedObj = propValue as JsonObject || {};
                  return (
                    <div key={key} className="space-y-1.5">
                      <label className="text-xs font-mono font-bold text-gray-700">
                        {propSchema.label || key}:
                      </label>
                      {propSchema.description && (
                        <p className="text-xs text-gray-500 mb-1">{propSchema.description}</p>
                      )}
                      <div className="border border-gray-300 rounded p-1.5 bg-gray-50 space-y-1.5">
                        {Object.entries(nestedObj).map(([nestedKey, nestedVal]) => (
                          <div key={nestedKey} className="grid grid-cols-2 gap-1.5 items-center">
                            <label className="text-xs font-mono text-gray-700 truncate" title={nestedKey}>
                              {nestedKey}:
                            </label>
                            <Input
                              type="text"
                              value={String(nestedVal || '')}
                              onChange={e => {
                                const updated = { ...nestedObj, [nestedKey]: e.target.value };
                                handlePropertyChange(key, updated);
                              }}
                              disabled={disabled}
                              className="h-6 text-xs font-mono border-black focus:ring-2 focus:ring-black px-1.5"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                return null;
              })}
            </div>
            <div className="border-t border-gray-300 p-1.5 flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowJsonEditor(true)}
                disabled={disabled}
                className="h-6 px-1.5 text-xs border-black hover:bg-black hover:text-white"
              >
                Edit as JSON
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReset}
                disabled={disabled}
                className="h-6 px-1.5 text-xs border-black hover:bg-black hover:text-white"
              >
                Reset to Default
              </Button>
            </div>
          </div>
        ) : isFlat && !showJsonEditor && !isEditing ? (
          /* Show individual fields for flat key-value objects */
          <div className="border-2 border-black bg-white rounded">
            <div className="p-2 space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
              {Object.entries(currentValue as JsonObject).map(([key, val]) => (
                <div key={key} className="grid grid-cols-2 gap-2 items-center">
                  <label className="text-xs font-mono text-gray-700 truncate" title={key}>
                    {key}:
                  </label>
                  {/* Render dropdown if value_options are available (from value_schema) */}
                  {schema.value_type === 'select' && schema.value_options ? (
                    <Select
                      value={String(val || '')}
                      onValueChange={value => handleFieldChange(key, value)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-6 text-xs border-black focus:ring-2 focus:ring-black px-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {schema.value_options.map((option) => (
                          <SelectItem key={option} value={option} className="text-xs py-1">
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type="text"
                      value={String(val || '')}
                      onChange={e => handleFieldChange(key, e.target.value)}
                      disabled={disabled}
                      className="h-6 text-xs font-mono border-black focus:ring-2 focus:ring-black px-1.5"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="border-t border-gray-300 p-1.5 flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowJsonEditor(true)}
                disabled={disabled}
                className="h-6 px-1.5 text-xs border-black hover:bg-black hover:text-white"
              >
                Edit as JSON
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReset}
                disabled={disabled}
                className="h-6 px-1.5 text-xs border-black hover:bg-black hover:text-white"
              >
                Reset to Default
              </Button>
            </div>
          </div>
        ) : !isEditing ? (
          /* JSON preview for complex objects or when explicitly requested */
          <div className="border-2 border-black bg-gray-50 rounded">
            <div className="p-2 max-h-40 overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {prettyJson}
              </pre>
            </div>
            <div className="border-t border-gray-300 p-1.5 flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={handleEdit}
                disabled={disabled}
                className="h-6 px-1.5 text-xs border-black hover:bg-black hover:text-white"
              >
                Edit JSON
              </Button>
              {isFlat && showJsonEditor && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowJsonEditor(false)}
                  disabled={disabled}
                  className="h-6 px-1.5 text-xs border-black hover:bg-black hover:text-white"
                >
                  Show Fields
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleReset}
                disabled={disabled}
                className="h-6 px-1.5 text-xs border-black hover:bg-black hover:text-white"
              >
                Reset to Default
              </Button>
            </div>
          </div>
        ) : (
          /* JSON editor mode */
          <div className="border-2 border-black rounded">
            <textarea
              className="w-full h-48 font-mono text-xs p-2 border-0 focus:outline-none focus:ring-2 focus:ring-black"
              value={jsonText}
              onChange={e => {
                setJsonText(e.target.value);
                setJsonError(undefined);
              }}
              disabled={disabled}
            />
            {jsonError && (
              <div className="px-2 py-1 bg-red-50 border-t border-red-300">
                <p className="text-xs text-red-600 font-mono">❌ {jsonError}</p>
              </div>
            )}
            <div className="border-t border-gray-300 p-1.5 flex gap-1.5">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={disabled}
                className="h-6 px-2 text-xs bg-black text-white hover:bg-gray-800"
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  handleCancel();
                  setShowJsonEditor(false);
                }}
                disabled={disabled}
                className="h-6 px-2 text-xs border-black hover:bg-black hover:text-white"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-red-500 text-xs mt-1 font-mono">{error}</p>}
      </div>
    </div>
  );
};

const ParameterField = ({
  label,
  path,
  values,
  onAddValue,
  onRemoveValue,
  error,
  schema,
  disabled = false,
  secrets,
  loadingSecrets,
}: {
  label: string;
  path: string;
  values: JsonValue[];
  onAddValue: (path: string, value: string) => string | undefined;
  onRemoveValue: (path: string, index: number) => void;
  error?: string;
  schema: SchemaItem;
  disabled?: boolean;
  secrets: Secret[];
  loadingSecrets: boolean;
}) => {
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | undefined>();
  const [showSecretsDropdown, setShowSecretsDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<'below' | 'above'>('below');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Calculate dropdown position when opening
  useEffect(() => {
    if (showSecretsDropdown && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - buttonRect.bottom;
      const spaceAbove = buttonRect.top;

      // Assume dropdown height of ~256px (max-h-64 = 16rem = 256px)
      const dropdownHeight = 256;

      // If not enough space below but more space above, show above
      if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
        setDropdownPosition('above');
      } else {
        setDropdownPosition('below');
      }
    }
  }, [showSecretsDropdown]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSecretsDropdown(false);
      }
    };

    if (showSecretsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showSecretsDropdown]);

  const handleAddValue = () => {
    if (disabled) return;
    const err = onAddValue(path, String(inputValue).trim());
    if (!err) {
      setInputValue('');
      setInputError(undefined);
    } else {
      setInputError(err);
    }
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    if (inputError) {
      setInputError(undefined);
    }
  };

  const handleSelectAndAdd = (val: string) => {
    if (!val || disabled) return;
    const err = onAddValue(path, val);
    if (err) {
      setInputError(err);
    } else if (inputError) {
      setInputError(undefined);
    }
  };

  const renderDynamicInput = () => {
    const placeholder = schema.default ? `${schema.default}` : 'Add a value...';

    if (schema.type === 'checkbox-list' && schema.options) {
      return (
        <CheckboxListField
          options={schema.options as Array<{ value: string; label: string }>}
          selectedValues={values}
          onToggle={(value, checked) => {
            if (checked) {
              const err = onAddValue(path, value);
              if (err) setInputError(err);
            } else {
              const index = values.findIndex(v => String(v) === value);
              if (index >= 0) onRemoveValue(path, index);
            }
          }}
          disabled={disabled}
        />
      );
    }

    if (schema.type === 'select' && schema.options) {
      const unselectedOptions = schema.options.filter(
        (option: { value: string; label: string }) =>
          !values.some(v => String(v) === option.value)
      );

      const handleSelectAllAvailable = () => {
        unselectedOptions.forEach(
          (option: { value: string; label: string }) => {
            const err = onAddValue(path, option.value);
            if (err) setInputError(err);
          }
        );
      };

      return (
        <div className="w-56">
          <div className="flex gap-1 mb-1">
            <Select
              onValueChange={handleSelectAndAdd}
              value=""
              disabled={disabled}
            >
              <SelectTrigger
                className="flex-1 h-6 text-xs font-mono border-black"
                size="sm"
              >
                <SelectValue placeholder="Select a value..." />
              </SelectTrigger>
              <SelectContent>
                {schema.options.map(
                  (option: { value: string; label: string }, index: number) => {
                    const isSelected = values.some(
                      v => String(v) === option.value
                    );
                    return (
                      <SelectItem
                        key={`${path}-option-${option.value}-${index}`}
                        value={option.value}
                        disabled={isSelected}
                        className={
                          isSelected ? 'text-muted-foreground line-through text-xs py-1' : 'text-xs py-1'
                        }
                      >
                        {option.label}
                      </SelectItem>
                    );
                  }
                )}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSelectAllAvailable}
              disabled={disabled || unselectedOptions.length === 0}
              className="h-6 px-1.5 text-xs border-black hover:bg-gray-100 flex-shrink-0"
              title={`Select all ${unselectedOptions.length} remaining options`}
            >
              All
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="w-56 flex gap-1 relative">
        <Input
          type={schema.type === 'number' ? 'number' : 'text'}
          value={inputValue}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddValue()}
          className="flex-1 h-6 text-xs font-mono border-black px-1.5"
          placeholder={placeholder}
          disabled={disabled}
        />
        <div className="flex gap-1 flex-shrink-0 relative" ref={dropdownRef}>
          <Button
            ref={buttonRef}
            size="icon"
            variant="outline"
            onClick={() => setShowSecretsDropdown(!showSecretsDropdown)}
            className="h-6 w-6 border-black p-0.5"
            disabled={disabled}
            title="Select from secrets"
          >
            <Key className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={handleAddValue}
            className="h-6 w-6 border-black p-0.5"
            disabled={disabled}
          >
            <CornerDownLeft className="h-3 w-3" />
          </Button>

          {/* Secrets dropdown */}
          {showSecretsDropdown && (
            <div className={`absolute right-0 w-64 bg-white border-2 border-black shadow-lg z-50 max-h-64 overflow-y-auto custom-scrollbar ${
              dropdownPosition === 'above'
                ? 'bottom-full mb-1'
                : 'top-full mt-1'
            }`}>
              {loadingSecrets ? (
                <div className="p-4 text-center">
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  <p className="text-xs text-gray-600 mt-2">Loading secrets...</p>
                </div>
              ) : secrets.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-xs text-gray-600">No secrets configured</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Go to Settings → Secrets to create one
                  </p>
                </div>
              ) : (
                <div>
                  {secrets.map((secret) => (
                    <button
                      key={secret.id}
                      type="button"
                      onClick={() => {
                        const secretPlaceholder = `\${${secret.name}}`;
                        const err = onAddValue(path, secretPlaceholder);
                        if (!err) {
                          setShowSecretsDropdown(false);
                        } else {
                          setInputError(err);
                        }
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-100 border-b border-gray-200 last:border-b-0"
                    >
                      <div className="flex items-center gap-2">
                        <Key className="w-3 h-3 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-xs font-bold truncate">
                            {secret.name}
                          </p>
                          {secret.description && (
                            <p className="text-xs text-gray-500 truncate">
                              {secret.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Special layout for checkbox-list fields - no need for tag display
  if (schema.type === 'checkbox-list') {
    return (
      <div className="grid grid-cols-3 gap-2 items-start">
        <Label
          htmlFor={path}
          className="text-xs font-medium text-gray-700 pt-0.5 col-span-1"
        >
          {label}:
        </Label>
        <div className="col-span-2 flex flex-col items-start gap-1.5">
          {renderDynamicInput()}
          {inputError && <p className="text-red-500 text-xs">{inputError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2 items-start">
      <Label
        htmlFor={path}
        className="text-xs font-medium text-gray-700 pt-0.5 col-span-1"
      >
        {label}:
      </Label>
      <div className="col-span-2 flex flex-col items-end gap-1.5">
        <div className="w-full flex-1 flex items-center gap-2">
          <div className="flex flex-wrap gap-1 flex-1">
            {values.map((val, index) => (
              <div
                key={`${path}-${val}-${index}`}
                className={`relative group flex items-center gap-0.5 bg-gray-100 hover:bg-gray-200 rounded px-1 py-[1px] text-[10px] leading-tight transition-colors border ${error ? 'border-red-500' : 'border-black'}`}
              >
                <span>{String(val)}</span>
                <button
                  onClick={() => onRemoveValue(path, index)}
                  className="text-gray-500 hover:text-black p-0 flex items-center"
                  disabled={disabled}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
                {error && (
                  <div className="absolute bottom-full mb-2 w-max bg-black text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {error}
                  </div>
                )}
              </div>
            ))}
          </div>
          {renderDynamicInput()}
        </div>
        {inputError && (
          <p className="text-red-500 text-xs text-right w-full">{inputError}</p>
        )}
      </div>
    </div>
  );
};

const ParameterRow = ({
  path,
  schemaItem,
  dynamicValues,
  errors,
  onAddDynamicValue,
  onRemoveDynamicValue,
  onSetObjectValue,
  secrets,
  loadingSecrets,
}: {
  path: string;
  schemaItem: SchemaItem;
  dynamicValues: Record<string, JsonValue[]>;
  errors: Record<string, string>;
  onAddDynamicValue: (path: string, value: string) => string | undefined;
  onRemoveDynamicValue: (path: string, index: number) => void;
  onSetObjectValue: (path: string, value: JsonValue) => void;
  secrets: Secret[];
  loadingSecrets: boolean;
}) => {
  // Handle array-type variables with item_schema
  if (schemaItem.type === 'array' && schemaItem.item_schema) {
    const currentValue = dynamicValues[path]?.[0];
    return (
      <ArrayField
        key={path}
        path={path}
        label={schemaItem.label || path}
        value={currentValue}
        onChange={onSetObjectValue}
        schema={schemaItem}
        error={errors[path]}
      />
    );
  }

  // Handle object-type variables
  if (schemaItem.type === 'object') {
    const currentValue = dynamicValues[path]?.[0];
    return (
      <ObjectField
        key={path}
        path={path}
        label={schemaItem.label || path}
        value={currentValue}
        onChange={onSetObjectValue}
        schema={schemaItem}
        error={errors[path]}
      />
    );
  }

  if (schemaItem.controls && typeof schemaItem.controls === 'object') {
    const selectedValues = dynamicValues[path] || [];
    return (
      <div key={path} className="mb-3">
        <ParameterField
          path={path}
          label={schemaItem.label || path}
          values={selectedValues}
          onAddValue={onAddDynamicValue}
          onRemoveValue={onRemoveDynamicValue}
          error={errors[path]}
          schema={schemaItem}
          secrets={secrets}
          loadingSecrets={loadingSecrets}
        />
        <div className="pl-6 mt-2 space-y-3">
          {Object.entries(schemaItem.controls).map(
            ([branchValue, branchControls]) => {
              const isSelected = selectedValues.includes(branchValue);
              return (
                <div key={`${path}-branch-${branchValue}`}>
                  <h4
                    className={`text-sm font-medium mb-1.5 ${isSelected ? 'text-gray-800' : 'text-gray-400'}`}
                  >
                    {branchValue}
                  </h4>
                  <div className="pl-3 space-y-3">
                    {isSelected &&
                      Object.entries(branchControls).map(
                        ([branchParamName, branchParamDef]) => (
                          <ParameterRow
                            key={`${path}-${branchValue}-${branchParamName}`}
                            path={branchParamName}
                            schemaItem={branchParamDef}
                            dynamicValues={dynamicValues}
                            errors={errors}
                            onAddDynamicValue={onAddDynamicValue}
                            onRemoveDynamicValue={onRemoveDynamicValue}
                            onSetObjectValue={onSetObjectValue}
                            secrets={secrets}
                            loadingSecrets={loadingSecrets}
                          />
                        )
                      )}
                  </div>
                </div>
              );
            }
          )}
        </div>
      </div>
    );
  }

  // Hide controlled parameters from the top level
  // This logic needs access to the full schema, which isn't ideal here.
  // A better approach would be to pre-filter the schema before mapping.
  // For now, this will have to do.

  return (
    <ParameterField
      path={path}
      label={schemaItem.label || path}
      values={dynamicValues[path] || []}
      onAddValue={onAddDynamicValue}
      onRemoveValue={onRemoveDynamicValue}
      error={errors[path]}
      schema={schemaItem}
      secrets={secrets}
      loadingSecrets={loadingSecrets}
    />
  );
};

export function BatchForm({
  schema,
  initialValues,
  onSpecChange,
  onCombinationsChange,
  initialSpec,
}: BatchFormProps) {
  const initializeDynamicValues = useCallback(() => {
    if (initialSpec && Object.keys(initialSpec.dynamic_parameters).length > 0) {
      return initialSpec.dynamic_parameters;
    }

    const initialDynamic: Record<string, JsonValue[]> = {};
    const flatInitialValues = flattenSchema(initialValues);

    // Initialize all parameters with their defaults
    for (const path in schema) {
      const schemaItem = schema[path] as SchemaItem;
      const initialValue =
        flatInitialValues[path]?.default ?? schemaItem?.default;

      if (initialValue !== undefined && initialValue !== null) {
        // For object types, always store as single-element array (even if default is an object)
        if (schemaItem?.type === 'object') {
          initialDynamic[path] = [initialValue];
          console.log(`🔧 Initialized object variable: ${path}`);
        } else if (Array.isArray(initialValue)) {
          initialDynamic[path] = initialValue;
        } else {
          initialDynamic[path] = [initialValue];
        }
      }
    }

    // Check for control branches that are active by default and populate their children
    for (const path in schema) {
      const schemaItem = schema[path] as SchemaItem;
      const selectedBranches = initialDynamic[path];

      if (
        schemaItem.controls &&
        selectedBranches &&
        selectedBranches.length > 0
      ) {
        selectedBranches.forEach(branchValue => {
          const branchControls = schemaItem.controls?.[branchValue as string];
          if (branchControls) {
            for (const controlPath in branchControls) {
              const controlSchema = branchControls[controlPath];
              if (
                (!initialDynamic[controlPath] ||
                  initialDynamic[controlPath].length === 0) &&
                controlSchema.default !== undefined &&
                controlSchema.default !== null
              ) {
                initialDynamic[controlPath] = [controlSchema.default];
              }
            }
          }
        });
      }
    }

    return initialDynamic;
  }, [schema, initialValues, initialSpec]);

  const [dynamicValues, setDynamicValues] = useState<
    Record<string, JsonValue[]>
  >(initializeDynamicValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loadingSecrets, setLoadingSecrets] = useState(false);

  // Fetch secrets on mount
  useEffect(() => {
    const fetchSecrets = async () => {
      try {
        setLoadingSecrets(true);
        const response = await fetch('/api/secrets');
        if (!response.ok) throw new Error('Failed to fetch secrets');
        const data = await response.json();
        setSecrets(data.secrets || []);
      } catch (err) {
        console.error('Error loading secrets:', err);
      } finally {
        setLoadingSecrets(false);
      }
    };

    fetchSecrets();
  }, []);

  const validateValue = useCallback(
    (path: string, value: string): string | undefined => {
      const flatSchema = flattenSchema(schema);
      const schemaItem = flatSchema[path];
      if (!schemaItem) return;

      if (schemaItem.type === 'number' && isNaN(Number(value))) {
        return schemaItem.validation_message || 'Must be a number.';
      }

      if (schemaItem.regex) {
        try {
          const regex = new RegExp(schemaItem.regex);
          if (!regex.test(value)) {
            return schemaItem.validation_message || `Invalid format.`;
          }
        } catch {
          console.error('Invalid regex in schema:', schemaItem.regex);
          return schemaItem.validation_message || `Invalid regex in schema.`;
        }
      }
      return undefined;
    },
    [schema]
  );

  useEffect(() => {
    const newErrors: Record<string, string> = {};
    Object.keys(dynamicValues).forEach(path => {
      (dynamicValues[path] || []).forEach(val => {
        const error = validateValue(path, String(val));
        if (error) {
          if (!newErrors[path]) newErrors[path] = error;
        }
      });
    });
    setErrors(newErrors);
  }, [dynamicValues, validateValue]);

  const handleAddDynamicValue = (path: string, value: string) => {
    if (!value) return;
    const error = validateValue(path, value);
    if (error) {
      return error;
    }

    // Convert value to proper type based on schema
    const flatSchema = flattenSchema(schema);
    const schemaItem = flatSchema[path];
    let typedValue: JsonValue = value;
    if (schemaItem?.type === 'number') {
      typedValue = Number(value);
    } else if (schemaItem?.type === 'boolean') {
      typedValue = value.toLowerCase() === 'true';
    }

    setDynamicValues(prev => {
      const newDynamicValues = {
        ...prev,
        [path]: [...(prev[path] || []), typedValue],
      };

      const schemaItem = schema[path] as SchemaItem;
      if (schemaItem?.controls?.[value]) {
        const branchControls = schemaItem.controls[value];

        for (const controlPath in branchControls) {
          const controlSchema = branchControls[controlPath];

          if (
            (!newDynamicValues[controlPath] ||
              newDynamicValues[controlPath].length === 0) &&
            controlSchema.default !== undefined &&
            controlSchema.default !== null
          ) {
            newDynamicValues[controlPath] = [controlSchema.default];
          }
        }
      }
      return newDynamicValues;
    });

    return undefined;
  };

  const handleRemoveDynamicValue = (path: string, index: number) => {
    setDynamicValues(prev => {
      const newDynamic = { ...prev };
      const values = newDynamic[path] || [];
      const valueToRemove = values[index];
      const updatedValues = values.filter((_, i) => i !== index);

      if (updatedValues.length > 0) {
        newDynamic[path] = updatedValues;
      } else {
        const schemaItem = schema[path] as SchemaItem;
        if (
          schemaItem &&
          schemaItem.default !== undefined &&
          schemaItem.default !== null
        ) {
          newDynamic[path] = [schemaItem.default];
        } else {
          delete newDynamic[path];
        }
      }

      const schemaItem = schema[path] as SchemaItem;
      if (schemaItem?.controls?.[valueToRemove as string]) {
        const branchControls = schemaItem.controls[valueToRemove as string];
        for (const controlPath in branchControls) {
          delete newDynamic[controlPath];
        }
      }

      return newDynamic;
    });
  };

  const handleSetObjectValue = (path: string, value: JsonValue) => {
    setDynamicValues(prev => ({
      ...prev,
      [path]: [value], // Store object as single-element array
    }));
  };

  useEffect(() => {
    const filtered_dynamic_parameters: Record<string, JsonValue[]> = {};

    console.log('🔍 BatchForm: Processing dynamic values:', dynamicValues);

    for (const path in dynamicValues) {
      const values = dynamicValues[path];
      if (values && values.length > 0) {
        // Skip internal-only parameters that shouldn't be included in combinations
        if (path === 'quote_parser' || path === 'products_parser') {
          continue;
        }

        let isControlled = false;
        let isActive = false;

        for (const sKey in schema) {
          const sValue = schema[sKey] as SchemaItem;
          if (sValue.controls) {
            const selectedBranches = dynamicValues[sKey] || [];
            for (const branchKey in sValue.controls) {
              if (sValue.controls[branchKey][path]) {
                isControlled = true;
                if (selectedBranches.includes(branchKey)) {
                  isActive = true;
                }
              }
            }
          }
        }

        if (!isControlled || isActive) {
          filtered_dynamic_parameters[path] = values;
        }
      }
    }

    console.log(
      '[SUCCESS] BatchForm: Filtered dynamic parameters:',
      filtered_dynamic_parameters
    );

    const calculateConditionalCombinations = (
      params: Record<string, JsonValue[]>
    ): number => {
      let totalCombinations = 0;
      const controlVariables = Object.keys(schema).filter(
        k => (schema[k] as SchemaItem).controls
      );

      if (controlVariables.length > 0) {
        const controlVar = controlVariables[0];
        const controlValues = params[controlVar] || [];

        if (controlValues.length === 0) return 1;

        // Find all parameters that are controlled by any branch
        const allControlledParams = new Set<string>();
        for (const branch of Object.values(
          (schema[controlVar] as SchemaItem).controls!
        )) {
          Object.keys(branch).forEach(key => allControlledParams.add(key));
        }

        // Find global parameters (not controlled by any branch)
        const globalParams = Object.keys(params).filter(
          key => key !== controlVar && !allControlledParams.has(key)
        );

        controlValues.forEach(cVal => {
          let branchCombinations = 1;

          // Multiply by global parameters (parameters not controlled by any branch)
          globalParams.forEach(key => {
            const values = params[key];
            if (values && values.length > 0) {
              const schemaItem = schema[key] as SchemaItem;
              // Checkbox fields and object fields contribute 1 combination (treated as static config)
              // Other field types contribute values.length combinations (each value is separate)
              if (schemaItem && (schemaItem.type === 'checkbox-list' || schemaItem.type === 'object')) {
                branchCombinations *= 1;
                console.log(
                  `🔍 Global ${schemaItem.type} field ${key}: contributing 1 combination`
                );
              } else {
                branchCombinations *= values.length;
                console.log(
                  `🔍 Global ${schemaItem?.type || 'field'} ${key}: contributing ${values.length} combinations`
                );
              }
            }
          });

          // Multiply by this branch's specific parameters
          const branchParams = (schema[controlVar] as SchemaItem).controls![
            cVal as string
          ];
          if (branchParams) {
            Object.keys(branchParams).forEach(bpKey => {
              const values = params[bpKey];
              if (values && values.length > 0) {
                const branchSchemaItem = branchParams[bpKey];
                // Checkbox fields and object fields contribute 1 combination (treated as static config)
                // Other field types contribute values.length combinations (each value is separate)
                if (
                  branchSchemaItem &&
                  (branchSchemaItem.type === 'checkbox-list' || branchSchemaItem.type === 'object')
                ) {
                  branchCombinations *= 1;
                  console.log(
                    `🔍 Branch ${branchSchemaItem.type} field ${bpKey}: contributing 1 combination`
                  );
                } else {
                  branchCombinations *= values.length;
                  console.log(
                    `🔍 Branch ${branchSchemaItem?.type || 'field'} ${bpKey}: contributing ${values.length} combinations`
                  );
                }
              }
            });
          }
          totalCombinations += branchCombinations;
        });
      } else {
        totalCombinations = 1;
        Object.keys(params).forEach(key => {
          const values = params[key];
          if (values && values.length > 0) {
            const schemaItem = schema[key] as SchemaItem;
            // Checkbox fields and object fields contribute 1 combination (treated as static config)
            // Other field types contribute values.length combinations (each value is separate)
            if (schemaItem && (schemaItem.type === 'checkbox-list' || schemaItem.type === 'object')) {
              totalCombinations *= 1;
              console.log(
                `🔍 ${schemaItem.type} field ${key}: contributing 1 combination`
              );
            } else {
              totalCombinations *= values.length;
              console.log(
                `🔍 ${schemaItem?.type || 'Field'} ${key}: contributing ${values.length} combinations`
              );
            }
          }
        });
      }
      return totalCombinations;
    };

    const totalCombinations = calculateConditionalCombinations(
      filtered_dynamic_parameters
    );

    const isValid = Object.keys(errors).length === 0;
    onSpecChange(
      {
        static_parameters: {},
        dynamic_parameters: filtered_dynamic_parameters,
      },
      isValid
    );
    onCombinationsChange(totalCombinations);
  }, [dynamicValues, schema, errors, onSpecChange, onCombinationsChange]);

  // Pre-filter the schema to remove controlled variables and internal-only parameters from the top-level rendering
  const topLevelSchema = { ...schema };
  for (const key in schema) {
    const item = schema[key] as SchemaItem;
    if (item.controls) {
      for (const branch of Object.values(item.controls)) {
        for (const controlledKey in branch) {
          delete topLevelSchema[controlledKey];
        }
      }
    }
  }

  // Remove internal-only parameters that shouldn't be exposed in the UI
  delete topLevelSchema.quote_parser;
  delete topLevelSchema.products_parser;

  // Split parameters into enrichment vs regular for a clearer layout
  const entries = Object.entries(topLevelSchema);
  const enrichmentEntries = entries.filter(
    ([p]) => p.startsWith('enrichment.') || p === 'mediar_parser.schema'
  );
  const regularEntries = entries.filter(
    ([p]) => !p.startsWith('enrichment.') && p !== 'mediar_parser.schema'
  );

  // Helper: set a single string value (used for custom editors)
  const setSingleValue = (path: string, value: string) => {
    setDynamicValues(prev => ({ ...prev, [path]: [value] }));
  };

  return (
    <div className="space-y-4 px-6 pb-6">
      {/* Regular parameters */}
      <div className="space-y-3">
        {regularEntries.map(([path, schemaItem]) => (
          <ParameterRow
            key={path}
            path={path}
            schemaItem={schemaItem as SchemaItem}
            dynamicValues={dynamicValues}
            errors={errors}
            onAddDynamicValue={handleAddDynamicValue}
            onRemoveDynamicValue={handleRemoveDynamicValue}
            onSetObjectValue={handleSetObjectValue}
            secrets={secrets}
            loadingSecrets={loadingSecrets}
          />
        ))}
      </div>

      {/* AI Enrichment section with visual separator and no-code editors */}
      {enrichmentEntries.length > 0 && (
        <div className="pt-4 mt-2 border-t border-black">
          <h4 className="text-sm font-semibold mb-3">AI Enrichment</h4>
          <div className="space-y-3">
            {enrichmentEntries.map(([path, schemaItemRaw]) => {
              const schemaItem = schemaItemRaw as SchemaItem;
              // Custom multiline JSON editor for mediar_parser.schema (preferred)
              if (
                path === 'mediar_parser.schema' ||
                path === 'enrichment.schema'
              ) {
                const current = (dynamicValues[path] &&
                  dynamicValues[path][0]) as string | undefined;
                return (
                  <div
                    key={path}
                    className="grid grid-cols-3 gap-3 items-start"
                  >
                    <Label
                      htmlFor={path}
                      className="text-sm font-medium text-gray-700 pt-0.5 col-span-1"
                    >
                      {(schemaItem && schemaItem.label) || 'Schema (JSON)'}:
                    </Label>
                    <div className="col-span-2 space-y-2">
                      <textarea
                        id={path}
                        className="w-full h-28 font-mono text-xs border border-black rounded p-2"
                        placeholder="Paste JSON Schema here or leave blank and use Fields to extract"
                        value={current || ''}
                        onChange={e => setSingleValue(path, e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 border-black"
                          onClick={() => {
                            try {
                              const formatted = JSON.stringify(
                                JSON.parse(current || '{}'),
                                null,
                                2
                              );
                              setSingleValue(path, formatted);
                            } catch {}
                          }}
                        >
                          Format JSON
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 border-black"
                          onClick={() => {
                            try {
                              JSON.parse(current || '{}');
                              toast.success('Schema is valid JSON');
                            } catch (e: any) {
                              toast.error(
                                'Invalid JSON: ' + (e?.message || 'parse error')
                              );
                            }
                          }}
                        >
                          Validate
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }

              // Remove old enrichment.fields editor – schema is the single source of truth

              return (
                <ParameterRow
                  key={path}
                  path={path}
                  schemaItem={schemaItem as SchemaItem}
                  dynamicValues={dynamicValues}
                  errors={errors}
                  onAddDynamicValue={handleAddDynamicValue}
                  onRemoveDynamicValue={handleRemoveDynamicValue}
                  onSetObjectValue={handleSetObjectValue}
                  secrets={secrets}
                  loadingSecrets={loadingSecrets}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
