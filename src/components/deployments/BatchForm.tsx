'use client';

import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { X, CornerDownLeft } from 'lucide-react';

type JsonValue = string | number | boolean | { [x: string]: JsonValue } | Array<JsonValue> | null;
type JsonObject = { [x: string]: JsonValue };

enum ParamMode {
  Static = 'Static',
  Dynamic = 'Dynamic (Iterate)',
}

interface BatchFormProps {
  schema: JsonObject;
  initialValues: JsonObject;
  onSpecChange: (spec: { static_parameters: JsonObject; dynamic_parameters: Record<string, JsonValue[]> }) => void;
  onCombinationsChange: (count: number) => void;
  initialSpec?: { static_parameters: JsonObject; dynamic_parameters: Record<string, JsonValue[]> };
}

// Helper function to flatten nested values object
function flattenValues(values: JsonObject): Record<string, JsonValue> {
  const flat: Record<string, JsonValue> = {};
  const recurse = (obj: JsonObject, path = '') => {
    for (const key in obj) {
      const newPath = path ? `${path}.${key}` : key;
      const value = obj[key];
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        recurse(value as JsonObject, newPath);
      } else {
        flat[newPath] = value;
      }
    }
  };
  recurse(values);
  return flat;
}

const RecursiveField = ({
  path,
  value,
  mode,
  onModeChange,
  onStaticChange,
  onAddDynamicValue,
  onRemoveDynamicValue,
}: {
  path: string;
  value: JsonValue;
  mode: ParamMode;
  onModeChange: (path: string, mode: ParamMode) => void;
  onStaticChange: (path: string, value: string) => void;
  onAddDynamicValue: (path: string, value: string) => void;
  onRemoveDynamicValue: (path: string, index: number) => void;
}) => {
  const [inputValue, setInputValue] = useState('');

  const handleAddValue = () => {
    if (inputValue.trim()) {
      // Smart parsing that handles values with commas inside quotes or dollar amounts
      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < inputValue.length; i++) {
        const char = inputValue[i];
        
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
          current += char;
        } else if (char === ',' && !inQuotes) {
          // Check if this comma is part of a number (e.g., $100,000)
          const beforeComma = current.trim();
          const afterComma = i + 1 < inputValue.length ? inputValue[i + 1] : '';
          
          // If we have a dollar sign before and digits after, it's part of a number
          if (beforeComma.includes('$') && /^\d/.test(afterComma.trim())) {
            current += char;
          } else {
            // It's a separator comma
            if (current.trim()) {
              values.push(current.trim());
            }
            current = '';
          }
        } else {
          current += char;
        }
      }
      
      // Don't forget the last value
      if (current.trim()) {
        values.push(current.trim());
      }
      
      values.forEach(v => onAddDynamicValue(path, v));
      setInputValue('');
    }
  };

  return (
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
        <Input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onStaticChange(path, e.target.value)}
          className="flex-1 h-7 text-xs font-mono"
        />
      ) : (
        <div className="flex-1 flex items-center gap-2">
          {(value as JsonValue[]).length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {(value as JsonValue[]).map((val, index) => (
                <div key={index} className="flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0 text-xs">
                  <span>{String(val)}</span>
                  <button onClick={() => onRemoveDynamicValue(path, index)} className="text-gray-500 hover:text-black">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex gap-1">
            <Input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddValue()}
              className="w-40 h-7 text-xs font-mono"
              placeholder="e.g. $100,000, $250,000"
            />
            <Button size="sm" variant="outline" onClick={handleAddValue} className="h-7 px-2">
              <CornerDownLeft className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export function BatchForm({ schema, initialValues, onSpecChange, onCombinationsChange, initialSpec }: BatchFormProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _schema = schema; // Acknowledge the prop is unused for now
  const flatInitialValues = flattenValues(initialValues);
  
  // Initialize state from initialSpec if provided
  const initializeModes = () => {
    const modes: Record<string, ParamMode> = {};
    if (initialSpec) {
      Object.keys(flatInitialValues).forEach(path => {
        if (initialSpec.dynamic_parameters[path] && initialSpec.dynamic_parameters[path].length > 0) {
          modes[path] = ParamMode.Dynamic;
        } else {
          modes[path] = ParamMode.Static;
        }
      });
    } else {
      Object.keys(flatInitialValues).forEach(path => {
        modes[path] = ParamMode.Static;
      });
    }
    return modes;
  };

  const initializeStaticValues = () => {
    const values: Record<string, JsonValue> = {};
    Object.entries(flatInitialValues).forEach(([path, value]) => {
      if (initialSpec && initialSpec.static_parameters[path] !== undefined) {
        values[path] = initialSpec.static_parameters[path];
      } else {
        values[path] = value;
      }
    });
    return values;
  };

  const initializeDynamicValues = () => {
    const values: Record<string, JsonValue[]> = {};
    if (initialSpec) {
      Object.entries(initialSpec.dynamic_parameters).forEach(([path, vals]) => {
        values[path] = vals;
      });
    }
    return values;
  };

  const [modes, setModes] = useState<Record<string, ParamMode>>(initializeModes);
  const [staticValues, setStaticValues] = useState<Record<string, JsonValue>>(initializeStaticValues);
  const [dynamicValues, setDynamicValues] = useState<Record<string, JsonValue[]>>(initializeDynamicValues);

  const handleModeChange = (path: string, mode: ParamMode) => {
    setModes(prev => ({ ...prev, [path]: mode }));
    
    // When switching from Static to Dynamic, preserve the static value as the first dynamic value
    if (mode === ParamMode.Dynamic && modes[path] === ParamMode.Static) {
      const currentStaticValue = staticValues[path];
      if (currentStaticValue !== undefined && currentStaticValue !== null && currentStaticValue !== '') {
        setDynamicValues(prev => ({
          ...prev,
          [path]: [currentStaticValue]
        }));
      }
    }
  };

  const handleStaticChange = (path: string, value: string) => {
    setStaticValues(prev => {
        const newStatic = { ...prev };
        // Store the flat value directly
        newStatic[path] = value;
        return newStatic;
    })
  }

  const handleAddDynamicValue = (path: string, value: string) => {
    setDynamicValues(prev => ({
        ...prev,
        [path]: [...(prev[path] || []), value]
    }));
  }

  const handleRemoveDynamicValue = (path: string, index: number) => {
    setDynamicValues(prev => ({
        ...prev,
        [path]: prev[path].filter((_, i) => i !== index)
    }));
  }

  useEffect(() => {
    // Build nested static_parameters from flat staticValues
    const static_parameters: JsonObject = {};
    const dynamic_parameters: Record<string, JsonValue[]> = {};
    let combinations = 1;
    let hasDynamicParams = false;

    // First, build the nested structure for static parameters
    for (const path in staticValues) {
      if (modes[path] !== ParamMode.Dynamic) {
        const keys = path.split('.');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let current: any = static_parameters;
        
        // Create nested structure
        for(let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
                current[keys[i]] = {};
            }
            current = current[keys[i]];
        }
        
        current[keys[keys.length - 1]] = staticValues[path];
      }
    }

    // Then handle dynamic parameters
    for (const path in modes) {
      if (modes[path] === ParamMode.Dynamic) {
        hasDynamicParams = true;
        dynamic_parameters[path] = dynamicValues[path] || [];
        if (dynamicValues[path] && dynamicValues[path].length > 0) {
            combinations *= dynamicValues[path].length;
        } else {
            combinations = 0;
        }
      }
    }
    
    onSpecChange({ static_parameters, dynamic_parameters });
    // If no dynamic params, it's 1 static execution. If dynamic params exist but some are empty, it's 0
    onCombinationsChange(hasDynamicParams ? combinations : 1);
  }, [modes, staticValues, dynamicValues, onSpecChange, onCombinationsChange]);

  return (
    <div className="space-y-1">
      {Object.entries(flatInitialValues).map(([path, value]) => (
        <div key={path} className="grid grid-cols-12 gap-4 items-center px-6 py-0.5 hover:bg-gray-50">
            <Label htmlFor={path} className="col-span-3 text-sm font-mono truncate" title={path}>
                {path}
            </Label>
            <div className="col-span-9">
                 <RecursiveField
                    path={path}
                    value={modes[path] === ParamMode.Dynamic ? (dynamicValues[path] || []) : (staticValues[path] ?? value)}
                    mode={modes[path] || ParamMode.Static}
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
