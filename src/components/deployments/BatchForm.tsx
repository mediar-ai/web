'use client';

import React, { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  onSpecChange: (spec: { static_parameters: JsonObject; dynamic_parameters: Record<string, JsonValue[]> }) => void;
  onCombinationsChange: (count: number) => void;
  initialSpec?: { static_parameters: JsonObject; dynamic_parameters: Record<string, JsonValue[]> };
}

// Helper function to flatten nested schema
function flattenSchema(schema: JsonObject): Record<string, JsonValue> {
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
  recurse(schema);
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
      const values = inputValue.split(',').map(v => v.trim()).filter(v => v);
      values.forEach(v => onAddDynamicValue(path, v));
      setInputValue('');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={mode} onValueChange={(newMode) => onModeChange(path, newMode as ParamMode)}>
        <SelectTrigger className="w-[140px] h-8 text-xs">
          <SelectValue placeholder="Select Mode" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ParamMode.Static}>Static</SelectItem>
          <SelectItem value={ParamMode.Dynamic}>Dynamic (Iterate)</SelectItem>
        </SelectContent>
      </Select>
      
      {mode === ParamMode.Static ? (
        <Input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onStaticChange(path, e.target.value)}
          className="flex-1 h-8 text-xs font-mono"
        />
      ) : (
        <div className="flex-1 flex items-center gap-2">
          {(value as JsonValue[]).length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {(value as JsonValue[]).map((val, index) => (
                <div key={index} className="flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0.5 text-xs">
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
              className="w-48 h-8 text-xs font-mono"
              placeholder="Add values (comma-separated)"
            />
            <Button size="sm" variant="outline" onClick={handleAddValue} className="h-8 px-2">
              <CornerDownLeft className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export function BatchForm({ schema, onSpecChange, onCombinationsChange, initialSpec }: BatchFormProps) {
  const flatSchema = flattenSchema(schema);
  
  // Initialize state from initialSpec if provided
  const initializeModes = () => {
    const modes: Record<string, ParamMode> = {};
    if (initialSpec) {
      Object.keys(flatSchema).forEach(path => {
        if (initialSpec.dynamic_parameters[path] && initialSpec.dynamic_parameters[path].length > 0) {
          modes[path] = ParamMode.Dynamic;
        } else {
          modes[path] = ParamMode.Static;
        }
      });
    } else {
      Object.keys(flatSchema).forEach(path => {
        modes[path] = ParamMode.Static;
      });
    }
    return modes;
  };

  const initializeStaticValues = () => {
    const values: Record<string, JsonValue> = {};
    Object.entries(flatSchema).forEach(([path, value]) => {
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
  };

  const handleStaticChange = (path: string, value: string) => {
    setStaticValues(prev => {
        const newStatic = { ...prev };
        const keys = path.split('.');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let current: any = newStatic;
        
        // Create nested structure if it doesn't exist
        for(let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
                current[keys[i]] = {};
            }
            current = current[keys[i]];
        }
        
        current[keys[keys.length - 1]] = value;
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
    const static_parameters = { ...staticValues };
    const dynamic_parameters: Record<string, JsonValue[]> = {};
    let combinations = 1;

    for (const path in modes) {
      if (modes[path] === ParamMode.Dynamic) {
        dynamic_parameters[path] = dynamicValues[path] || [];
        if (dynamicValues[path] && dynamicValues[path].length > 0) {
            combinations *= dynamicValues[path].length;
        } else {
            combinations = 0;
        }
        // Remove from static params - handle nested paths safely
        const keys = path.split('.');
        let current: JsonObject | JsonValue = static_parameters;
        let isValid = true;
        
        for(let i = 0; i < keys.length - 1; i++) {
            if (current && typeof current === 'object' && !Array.isArray(current)) {
                current = (current as JsonObject)[keys[i]];
            } else {
                isValid = false;
                break;
            }
        }
        
        if (isValid && current && typeof current === 'object' && !Array.isArray(current)) {
            delete (current as JsonObject)[keys[keys.length - 1]];
        }
      }
    }
    onSpecChange({ static_parameters, dynamic_parameters });
    onCombinationsChange(combinations === 1 && Object.keys(dynamic_parameters).length > 0 ? 1 : (Object.keys(dynamic_parameters).length === 0 ? 0 : combinations));
  }, [modes, staticValues, dynamicValues, onSpecChange, onCombinationsChange]);

  return (
    <div className="space-y-4">
      {Object.entries(flatSchema).map(([path, value]) => (
        <div key={path} className="grid grid-cols-12 gap-4 items-center px-6 py-2 hover:bg-gray-50">
            <Label htmlFor={path} className="col-span-3 text-sm font-mono truncate" title={path}>
                {path}
            </Label>
            <div className="col-span-9">
                 <RecursiveField
                    path={path}
                    value={modes[path] === ParamMode.Dynamic ? (dynamicValues[path] || []) : value}
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
