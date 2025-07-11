'use client';

import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, CornerDownLeft } from 'lucide-react';

type JsonValue = string | number | boolean | { [x: string]: JsonValue } | Array<JsonValue> | null;
type JsonObject = { [x:string]: JsonValue };

interface BatchFormProps {
  schema: JsonObject;
  initialValues: JsonObject;
  onSpecChange: (spec: { static_parameters: JsonObject; dynamic_parameters: Record<string, JsonValue[]> }, isValid: boolean) => void;
  onCombinationsChange: (count: number) => void;
  initialSpec?: { static_parameters: JsonObject; dynamic_parameters: Record<string, JsonValue[]> };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenSchema(schema: JsonObject, path = '', acc: Record<string, any> = {}): Record<string, any> {
  for (const key in schema) {
    const newPath = path ? `${path}.${key}` : key;
    const value = schema[key] as JsonObject;
    if (value && typeof value === 'object' && !Array.isArray(value) && !value.type) {
        flattenSchema(value, newPath, acc);
    } else {
        acc[newPath] = value;
    }
  }
  return acc;
}

const ParameterField = ({
  path,
  value,
  schemaItem,
  dynamicErrors,
  onAddDynamicValue,
  onRemoveDynamicValue,
}: {
  path: string;
  value: JsonValue[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schemaItem: any;
  dynamicErrors: Record<string, string>;
  onAddDynamicValue: (path: string, value: string) => string | undefined;
  onRemoveDynamicValue: (path: string, index: number) => void;
}) => {
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | undefined>();

  const handleAddValue = () => {
    const error = onAddDynamicValue(path, String(inputValue).trim());
    if (!error) {
      setInputValue('');
      setInputError(undefined);
    } else {
      setInputError(error);
    }
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    if (inputError) {
      setInputError(undefined);
    }
  }

  const handleSelectAndAdd = (val: string) => {
    if (!val) return;
    const error = onAddDynamicValue(path, val);
    if (error) {
      setInputError(error);
    } else if (inputError) {
      setInputError(undefined);
    }
  };

  const renderDynamicInput = () => {
    const placeholder = schemaItem.default ? `${schemaItem.default}` : "Add a value...";

    if (schemaItem.type === 'select' && schemaItem.options) {
      return (
        <div className="flex gap-1">
          <Select onValueChange={handleSelectAndAdd} value="">
            <SelectTrigger className="w-56 h-7 text-xs font-mono">
              <SelectValue placeholder="Select a value..." />
            </SelectTrigger>
            <SelectContent>
              {schemaItem.options.map((option: { value: string; label: string }) => {
                const isSelected = value.some(v => String(v) === option.value);
                return (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    disabled={isSelected}
                    className={isSelected ? 'text-muted-foreground line-through' : ''}
                  >
                    {option.label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      );
    }

    return (
      <div className="flex gap-1">
        <Input
          type={schemaItem.type === 'number' ? 'number' : 'text'}
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddValue()}
          className="w-48 h-7 text-xs font-mono"
          placeholder={placeholder}
        />
        <Button size="icon" variant="outline" onClick={handleAddValue} className="h-7 w-7 flex-shrink-0">
          <CornerDownLeft className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col items-end gap-2">
        <div className="w-full flex-1 flex items-center gap-2">
            <div className="flex flex-wrap gap-1 flex-1">
                {value.map((val, index) => (
                <div key={index} className={`relative group flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0 text-xs ${dynamicErrors[`${path}-${index}`] ? 'border border-red-500' : ''}`}>
                    <span>{String(val)}</span>
                    <button onClick={() => onRemoveDynamicValue(path, index)} className="text-gray-500 hover:text-black">
                    <X className="h-3 w-3" />
                    </button>
                    {dynamicErrors[`${path}-${index}`] && (
                      <div className="absolute bottom-full mb-2 w-max bg-black text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {dynamicErrors[`${path}-${index}`]}
                      </div>
                    )}
                </div>
                ))}
            </div>
            {renderDynamicInput()}
        </div>
        {inputError && <p className="text-red-500 text-xs text-right w-full">{inputError}</p>}
    </div>
  );
};

export function BatchForm({ schema, initialValues, onSpecChange, onCombinationsChange, initialSpec }: BatchFormProps) {
  const flatSchema = flattenSchema(schema);
  const flatInitialValues = flattenSchema(initialValues);

  const initializeDynamicValues = () => {
    if (initialSpec && Object.keys(initialSpec.dynamic_parameters).length > 0) {
      return initialSpec.dynamic_parameters;
    }
    const initialDynamic: Record<string, JsonValue[]> = {};
    Object.keys(flatSchema).forEach(path => {
        const initialValue = flatInitialValues[path] ?? flatSchema[path]?.default;
        initialDynamic[path] = initialValue !== undefined && initialValue !== null ? [initialValue] : [];
    });
    return initialDynamic;
  };

  const [dynamicValues, setDynamicValues] = useState<Record<string, JsonValue[]>>(initializeDynamicValues);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateValue = (path: string, value: string): string | undefined => {
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
        console.error("Invalid regex in schema:", schemaItem.regex);
        return schemaItem.validation_message || `Invalid regex in schema.`;
      }
    }
    return undefined;
  };

  useEffect(() => {
    const newErrors: Record<string, string> = {};
    Object.keys(dynamicValues).forEach(path => {
      dynamicValues[path].forEach((val, index) => {
        const error = validateValue(path, String(val));
        if (error) newErrors[`${path}-${index}`] = error;
      });
    });
    setErrors(newErrors);
  }, [dynamicValues]);

  const handleAddDynamicValue = (path: string, value: string) => {
    if (!value) return;
    const error = validateValue(path, value);
    if (error) {
      return error;
    }
    setDynamicValues(prev => ({ ...prev, [path]: [...(prev[path] || []), value] }));
    return undefined;
  }

  const handleRemoveDynamicValue = (path: string, index: number) => {
    setDynamicValues(prev => {
        const newDynamic = {...prev};
        const updatedValues = (newDynamic[path] || []).filter((_, i) => i !== index);
        newDynamic[path] = updatedValues;
        return newDynamic;
    });
  }

  useEffect(() => {
    const dynamic_parameters: Record<string, JsonValue[]> = dynamicValues;
    let combinations = 1;

    const hasValues = Object.values(dynamic_parameters).some(arr => arr.length > 0);

    if (hasValues) {
        Object.values(dynamic_parameters).forEach(arr => {
            combinations *= arr.length > 0 ? arr.length : 0;
        });
    } else {
        combinations = 0;
    }
    
    const isValid = Object.keys(errors).length === 0;
    onSpecChange({ static_parameters: {}, dynamic_parameters }, isValid);
    onCombinationsChange(combinations);
  }, [dynamicValues, onSpecChange, onCombinationsChange, errors]);

  return (
    <div className="space-y-0">
      {Object.entries(flatSchema).map(([path, schemaItem]) => (
        <div key={path} className="grid grid-cols-12 gap-4 items-center px-6 py-1 hover:bg-gray-50">
            <Label htmlFor={path} className="col-span-3 text-sm font-mono truncate" title={path}>
                {path}
            </Label>
            <div className="col-span-9">
                 <ParameterField
                    path={path}
                    value={dynamicValues[path] || []}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    schemaItem={schemaItem}
                    dynamicErrors={errors}
                    onAddDynamicValue={handleAddDynamicValue}
                    onRemoveDynamicValue={handleRemoveDynamicValue}
                />
            </div>
        </div>
      ))}
    </div>
  );
};
