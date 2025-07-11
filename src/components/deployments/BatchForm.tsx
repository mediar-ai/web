'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, CornerDownLeft } from 'lucide-react';

type JsonValue = string | number | boolean | { [x: string]: JsonValue } | Array<JsonValue> | null;
type JsonObject = { [x:string]: JsonValue };

enum ParamMode {
  Static = 'Static',
  Dynamic = 'Dynamic (Iterate)',
}

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

const RecursiveField = ({
  path,
  value,
  schemaItem,
  mode,
  error,
  dynamicErrors,
  onModeChange,
  onStaticChange,
  onAddDynamicValue,
  onRemoveDynamicValue,
}: {
  path: string;
  value: JsonValue;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schemaItem: any;
  mode: ParamMode;
  error?: string;
  dynamicErrors: Record<string, string>;
  onModeChange: (path: string, mode: ParamMode) => void;
  onStaticChange: (path: string, value: string) => void;
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

  const renderStaticInput = () => {
    if (schemaItem.type === 'select' && schemaItem.options) {
      return (
        <Select value={String(value ?? '')} onValueChange={(val) => onStaticChange(path, val)}>
          <SelectTrigger className={`flex-1 h-7 text-xs font-mono ${error ? 'border-red-500' : ''}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {schemaItem.options.map((option: { value: string; label: string }) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input
        type={schemaItem.type === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        onChange={(e) => onStaticChange(path, e.target.value)}
        className={`flex-1 h-7 text-xs font-mono ${error ? 'border-red-500' : ''}`}
      />
    );
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
    <div className="flex flex-col">
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Static</span>
        <Switch
          id={path}
          checked={mode === ParamMode.Dynamic}
          onCheckedChange={(checked: boolean) => onModeChange(path, checked ? ParamMode.Dynamic : ParamMode.Static)}
        />
        <span className="text-xs text-muted-foreground">Dynamic</span>
      </div>
      
      {mode === ParamMode.Static ? (
        renderStaticInput()
      ) : (
        <div className="flex-1 flex items-center gap-2">
          {(value as JsonValue[]).length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {(value as JsonValue[]).map((val, index) => (
                <div key={index} className={`flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0 text-xs ${dynamicErrors[`${path}-${index}`] ? 'border border-red-500' : ''}`}>
                  <span>{String(val)}</span>
                  <button onClick={() => onRemoveDynamicValue(path, index)} className="text-gray-500 hover:text-black">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {renderDynamicInput()}
        </div>
      )}
    </div>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
};

export function BatchForm({ schema, initialValues, onSpecChange, onCombinationsChange, initialSpec }: BatchFormProps) {
  const flatSchema = flattenSchema(schema);
  const flatInitialValues = flattenSchema(initialValues);

  const initializeModes = () => {
    const modes: Record<string, ParamMode> = {};
    Object.keys(flatSchema).forEach(path => {
        modes[path] = (initialSpec?.dynamic_parameters?.[path]?.length > 0) ? ParamMode.Dynamic : ParamMode.Static;
    });
    return modes;
  };

  const initializeStaticValues = () => {
    const values: Record<string, JsonValue> = {};
    Object.keys(flatSchema).forEach(path => {
      values[path] = initialSpec?.static_parameters?.[path] ?? flatInitialValues[path] ?? flatSchema[path]?.default ?? '';
    });
    return values;
  };

  const initializeDynamicValues = () => initialSpec?.dynamic_parameters ?? {};

  const [modes, setModes] = useState<Record<string, ParamMode>>(initializeModes);
  const [staticValues, setStaticValues] = useState<Record<string, JsonValue>>(initializeStaticValues);
  const [dynamicValues, setDynamicValues] = useState<Record<string, JsonValue[]>>(initializeDynamicValues);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateValue = useCallback((path: string, value: string): string | undefined => {
    const schemaItem = flatSchema[path];
    if (!schemaItem) return;

    if (schemaItem.type === 'number' && isNaN(Number(value))) {
      return 'Must be a number.';
    }

    if (schemaItem && schemaItem.regex) {
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
  }, [flatSchema]);

  useEffect(() => {
    const newErrors: Record<string, string> = {};
    // Validate static values
    Object.keys(staticValues).forEach(path => {
      if (modes[path] === ParamMode.Static) {
        const error = validateValue(path, String(staticValues[path]));
        if (error) newErrors[path] = error;
      }
    });
    // Validate dynamic values
    Object.keys(dynamicValues).forEach(path => {
      if (modes[path] === ParamMode.Dynamic) {
        dynamicValues[path].forEach((val, index) => {
          const error = validateValue(path, String(val));
          if (error) newErrors[`${path}-${index}`] = error;
        });
      }
    });
    setErrors(newErrors);
  }, [staticValues, dynamicValues, modes, validateValue]);

  const handleModeChange = (path: string, mode: ParamMode) => {
    const currentModes = modes;
    if (mode === ParamMode.Dynamic && currentModes[path] === ParamMode.Static) {
      const currentStaticValue = staticValues[path];
      if (currentStaticValue !== undefined && String(currentStaticValue).trim() !== '') {
        setDynamicValues(prev => ({ ...prev, [path]: [currentStaticValue] }));
      }
    } else if (mode === ParamMode.Static && currentModes[path] === ParamMode.Dynamic) {
      const currentDynamicValues = dynamicValues[path];
      if (currentDynamicValues && currentDynamicValues.length > 0) {
        setStaticValues(prev => ({ ...prev, [path]: currentDynamicValues[0] }));
      }
    }
    setModes(prev => ({ ...prev, [path]: mode }));
  };

  const handleStaticChange = (path: string, value: string) => {
    setStaticValues(prev => ({ ...prev, [path]: value }));
  }

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
    const static_parameters: JsonObject = {};
    const dynamic_parameters: Record<string, JsonValue[]> = {};
    let combinations = 1;
    let hasDynamicParams = false;

    Object.keys(modes).forEach(path => {
      const keys = path.split('.');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let current: any = static_parameters;
      if (modes[path] === ParamMode.Static) {
        for(let i = 0; i < keys.length - 1; i++) {
          current[keys[i]] = current[keys[i]] || {};
          current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = staticValues[path];
      } else {
        hasDynamicParams = true;
        dynamic_parameters[path] = dynamicValues[path] || [];
        combinations *= dynamic_parameters[path].length > 0 ? dynamic_parameters[path].length : 0;
      }
    });
    
    const isValid = Object.keys(errors).length === 0;
    onSpecChange({ static_parameters, dynamic_parameters }, isValid);
    onCombinationsChange(hasDynamicParams ? combinations : (Object.keys(static_parameters).length > 0 ? 1 : 0));
  }, [modes, staticValues, dynamicValues, onSpecChange, onCombinationsChange, errors]);

  return (
    <div className="space-y-1">
      {Object.entries(flatSchema).map(([path, schemaItem]) => (
        <div key={path} className="grid grid-cols-12 gap-4 items-center px-6 py-2 hover:bg-gray-50 border-b">
            <Label htmlFor={path} className="col-span-3 text-sm font-mono truncate" title={path}>
                {path}
            </Label>
            <div className="col-span-9">
                 <RecursiveField
                    path={path}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    value={modes[path] === ParamMode.Dynamic ? (dynamicValues[path] || []) : (staticValues[path] ?? (schemaItem as any).default ?? '')}
                    schemaItem={schemaItem}
                    mode={modes[path] || ParamMode.Static}
                    error={errors[path]}
                    dynamicErrors={errors}
                    onModeChange={handleModeChange}
                    onStaticChange={handleStaticChange}
                    onAddDynamicValue={handleAddDynamicValue}
                    onRemoveDynamicValue={handleRemoveDynamicValue}
                />
            </div>
        </div>
      ))}
    </div>
  );
};
