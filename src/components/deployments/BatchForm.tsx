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
  onAddDynamicValue: (path: string, value: string) => void;
  onRemoveDynamicValue: (path: string, index: number) => void;
}) => {
  const [inputValue, setInputValue] = useState('');

  const handleAddValue = () => {
    if (String(inputValue).trim()) {
      onAddDynamicValue(path, String(inputValue).trim());
      setInputValue('');
    }
  };

  const renderDynamicInput = () => {
    if (schemaItem.type === 'select' && schemaItem.options) {
      return (
        <div className="flex gap-1">
          <Select value={inputValue} onValueChange={setInputValue}>
            <SelectTrigger className="w-40 h-7 text-xs font-mono">
              <SelectValue placeholder="Select a value..." />
            </SelectTrigger>
            <SelectContent>
              {schemaItem.options.map((option: { value: string; label: string }) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={handleAddValue} className="h-7 px-2">
            Add
          </Button>
        </div>
      );
    }

    return (
      <div className="flex gap-1">
        <Input
          type={schemaItem.type === 'number' ? 'number' : 'text'}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddValue()}
          className="w-40 h-7 text-xs font-mono"
          placeholder="e.g. val1, val2, val3"
        />
        <Button size="sm" variant="outline" onClick={handleAddValue} className="h-7 px-2">
          <CornerDownLeft className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  return (
    <div className="flex-1 flex items-center gap-2">
        <div className="flex flex-wrap gap-1 flex-1">
            {value.map((val, index) => (
            <div key={index} className={`flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0 text-xs ${dynamicErrors[`${path}-${index}`] ? 'border border-red-500' : ''}`}>
                <span>{String(val)}</span>
                <button onClick={() => onRemoveDynamicValue(path, index)} className="text-gray-500 hover:text-black">
                <X className="h-3 w-3" />
                </button>
            </div>
            ))}
        </div>
        {renderDynamicInput()}
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
      return 'Must be a number.';
    }

    if (schemaItem.regex) {
      try {
        const regex = new RegExp(schemaItem.regex);
        if (!regex.test(value)) {
          return `Invalid format.`;
        }
      } catch {
        console.error("Invalid regex in schema:", schemaItem.regex);
        return `Invalid regex in schema.`;
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
    setDynamicValues(prev => ({ ...prev, [path]: [...(prev[path] || []), value] }));
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
