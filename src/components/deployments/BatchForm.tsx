'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, CornerDownLeft } from 'lucide-react';

type JsonValue = string | number | boolean | { [x: string]: JsonValue } | Array<JsonValue> | null;
type JsonObject = { [x:string]: JsonValue };

interface SchemaItem {
  type?: string;
  label?: string;
  description?: string;
  default?: JsonValue;
  regex?: string;
  validation_message?: string;
  options?: Array<{ value: string; label: string }>;
  controls?: Record<string, Record<string, SchemaItem>>;
}

interface BatchFormProps {
  schema: JsonObject;
  initialValues: JsonObject;
  onSpecChange: (spec: { static_parameters: JsonObject; dynamic_parameters: Record<string, JsonValue[]> }, isValid: boolean) => void;
  onCombinationsChange: (count: number) => void;
  initialSpec?: { static_parameters: JsonObject; dynamic_parameters: Record<string, JsonValue[]> };
}

function flattenSchema(schema: JsonObject, path = '', acc: Record<string, SchemaItem> = {}): Record<string, SchemaItem> {
  for (const key in schema) {
    const newPath = path ? `${path}.${key}` : key;
    const value = schema[key] as JsonObject;
    if (value && typeof value === 'object' && !Array.isArray(value) && !value.type) {
        flattenSchema(value, newPath, acc);
    } else {
        acc[newPath] = value as SchemaItem;
    }
  }
  return acc;
}

const ParameterField = ({
  label,
  path,
  values,
  onAddValue,
  onRemoveValue,
  error,
  schema,
  disabled = false,
}: {
  label: string;
  path: string;
  values: JsonValue[];
  onAddValue: (path: string, value: string) => string | undefined;
  onRemoveValue: (path: string, index: number) => void;
  error?: string;
  schema: SchemaItem;
  disabled?: boolean;
}) => {
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | undefined>();

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
  }

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
    const placeholder = schema.default ? `${schema.default}` : "Add a value...";

    if (schema.type === 'select' && schema.options) {
      return (
        <div className="flex gap-1">
          <Select onValueChange={handleSelectAndAdd} value="" disabled={disabled}>
            <SelectTrigger className="w-56 text-xs font-mono" size="sm">
              <SelectValue placeholder="Select a value..." />
            </SelectTrigger>
            <SelectContent>
              {schema.options.map((option: { value: string; label: string }) => {
                const isSelected = values.some(v => String(v) === option.value);
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
          type={schema.type === 'number' ? 'number' : 'text'}
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddValue()}
          className="w-48 h-6 text-xs font-mono"
          placeholder={placeholder}
          disabled={disabled}
        />
        <Button size="icon" variant="outline" onClick={handleAddValue} className="h-6 w-6 flex-shrink-0" disabled={disabled}>
          <CornerDownLeft className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-3 gap-3 items-start">
      <Label htmlFor={path} className="text-sm font-medium text-gray-700 pt-0.5 col-span-1">{label}:</Label>
      <div className="col-span-2 flex flex-col items-end gap-1.5">
        <div className="w-full flex-1 flex items-center gap-2">
            <div className="flex flex-wrap gap-1 flex-1">
                {values.map((val, index) => (
                <div key={index} className={`relative group flex items-center gap-1 bg-gray-100 hover:bg-gray-200 rounded-md px-1.5 py-0.5 text-xs transition-colors ${error ? 'border border-red-500' : ''}`}>
                    <span>{String(val)}</span>
                    <button onClick={() => onRemoveValue(path, index)} className="text-gray-500 hover:text-black" disabled={disabled}>
                    <X className="h-3 w-3" />
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
        {inputError && <p className="text-red-500 text-xs text-right w-full">{inputError}</p>}
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
}: {
  path: string;
  schemaItem: SchemaItem;
  dynamicValues: Record<string, JsonValue[]>;
  errors: Record<string, string>;
  onAddDynamicValue: (path: string, value: string) => string | undefined;
  onRemoveDynamicValue: (path: string, index: number) => void;
}) => {
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
        />
        <div className="pl-6 mt-2 space-y-3">
          {Object.entries(schemaItem.controls).map(([branchValue, branchControls]) => {
            const isSelected = selectedValues.includes(branchValue);
            return (
              <div key={branchValue}>
                <h4 className={`text-sm font-medium mb-1.5 ${isSelected ? 'text-gray-800' : 'text-gray-400'}`}>{branchValue}</h4>
                <div className="pl-3 space-y-3">
                {isSelected && Object.entries(branchControls).map(([branchParamName, branchParamDef]) => (
                    <ParameterRow
                      key={branchParamName}
                      path={branchParamName}
                      schemaItem={branchParamDef}
                      dynamicValues={dynamicValues}
                      errors={errors}
                      onAddDynamicValue={onAddDynamicValue}
                      onRemoveDynamicValue={onRemoveDynamicValue}
                    />
                  ))}
                </div>
              </div>
            );
          })}
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
    />
  );
};


export function BatchForm({ schema, initialValues, onSpecChange, onCombinationsChange, initialSpec }: BatchFormProps) {
  const initializeDynamicValues = useCallback(() => {
    if (initialSpec && Object.keys(initialSpec.dynamic_parameters).length > 0) {
      return initialSpec.dynamic_parameters;
    }
    
    const initialDynamic: Record<string, JsonValue[]> = {};
    const flatInitialValues = flattenSchema(initialValues);

    // Initialize all parameters with their defaults
    for (const path in schema) {
      const initialValue = flatInitialValues[path]?.default ?? (schema[path] as SchemaItem)?.default;
      if (initialValue !== undefined && initialValue !== null) {
        initialDynamic[path] = Array.isArray(initialValue) ? initialValue : [initialValue];
      }
    }

    // Check for control branches that are active by default and populate their children
    for (const path in schema) {
      const schemaItem = schema[path] as SchemaItem;
      const selectedBranches = initialDynamic[path];

      if (schemaItem.controls && selectedBranches && selectedBranches.length > 0) {
        selectedBranches.forEach(branchValue => {
          const branchControls = schemaItem.controls?.[branchValue as string];
          if (branchControls) {
            for (const controlPath in branchControls) {
              const controlSchema = branchControls[controlPath];
              if ((!initialDynamic[controlPath] || initialDynamic[controlPath].length === 0) && controlSchema.default !== undefined && controlSchema.default !== null) {
                initialDynamic[controlPath] = [controlSchema.default];
              }
            }
          }
        });
      }
    }
    
    return initialDynamic;
  }, [schema, initialValues, initialSpec]);

  const [dynamicValues, setDynamicValues] = useState<Record<string, JsonValue[]>>(initializeDynamicValues);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateValue = useCallback((path: string, value: string): string | undefined => {
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
        console.error("Invalid regex in schema:", schemaItem.regex);
        return schemaItem.validation_message || `Invalid regex in schema.`;
      }
    }
    return undefined;
  }, [schema]);

  useEffect(() => {
    const newErrors: Record<string, string> = {};
    Object.keys(dynamicValues).forEach(path => {
      (dynamicValues[path] || []).forEach(val => {
        const error = validateValue(path, String(val));
        if (error) {
          if(!newErrors[path]) newErrors[path] = error;
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
    
    setDynamicValues(prev => {
      const newDynamicValues = { ...prev, [path]: [...(prev[path] || []), value] };

      const schemaItem = schema[path] as SchemaItem;
      if (schemaItem?.controls?.[value]) {
        const branchControls = schemaItem.controls[value];
        
        for (const controlPath in branchControls) {
          const controlSchema = branchControls[controlPath];
          
          if ((!newDynamicValues[controlPath] || newDynamicValues[controlPath].length === 0) && controlSchema.default !== undefined && controlSchema.default !== null) {
            newDynamicValues[controlPath] = [controlSchema.default];
          }
        }
      }
      return newDynamicValues;
    });

    return undefined;
  }

  const handleRemoveDynamicValue = (path: string, index: number) => {
    setDynamicValues(prev => {
        const newDynamic = {...prev};
        const values = (newDynamic[path] || []);
        const valueToRemove = values[index];
        const updatedValues = values.filter((_, i) => i !== index);
        
        if (updatedValues.length > 0) {
          newDynamic[path] = updatedValues;
        } else {
          const schemaItem = schema[path] as SchemaItem;
          if (schemaItem && schemaItem.default !== undefined && schemaItem.default !== null) {
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
  }

  useEffect(() => {
    const filtered_dynamic_parameters: Record<string, JsonValue[]> = {};
    
    for (const path in dynamicValues) {
      const values = dynamicValues[path];
      if (values && values.length > 0) {
        let isControlled = false;
        let isActive = false;

        for (const sKey in schema) {
          const sValue = schema[sKey] as SchemaItem;
          if(sValue.controls) {
            const selectedBranches = dynamicValues[sKey] || [];
            for (const branchKey in sValue.controls) {
              if (sValue.controls[branchKey][path]) {
                isControlled = true;
                if(selectedBranches.includes(branchKey)) {
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

    const calculateConditionalCombinations = (params: Record<string, JsonValue[]>): number => {
      let totalCombinations = 0;
      const controlVariables = Object.keys(schema).filter(k => (schema[k] as SchemaItem).controls);
      
      if (controlVariables.length > 0) {
        const controlVar = controlVariables[0];
        const controlValues = params[controlVar] || [];

        if (controlValues.length === 0) return 1;

        controlValues.forEach(cVal => {
          let branchCombinations = 1;
          
          Object.entries(params).forEach(([key, values]) => {
            if (key !== controlVar && !(schema[controlVar] as SchemaItem).controls![cVal as string][key]) {
              branchCombinations *= Math.max(1, values.length);
            }
          });
          
          const branchParams = (schema[controlVar] as SchemaItem).controls![cVal as string];
          Object.keys(branchParams).forEach(bpKey => {
            branchCombinations *= Math.max(1, (params[bpKey]?.length || 0));
          });
          totalCombinations += branchCombinations;
        });

      } else {
        totalCombinations = 1;
        Object.values(params).forEach(values => {
          if (values.length > 0) {
            totalCombinations *= values.length;
          }
        });
      }
      return totalCombinations;
    };
    
    const totalCombinations = calculateConditionalCombinations(filtered_dynamic_parameters);
    
    const isValid = Object.keys(errors).length === 0;
    onSpecChange({ static_parameters: {}, dynamic_parameters: filtered_dynamic_parameters }, isValid);
    onCombinationsChange(totalCombinations);
  }, [dynamicValues, schema, errors, onSpecChange, onCombinationsChange]);

  // Pre-filter the schema to remove controlled variables from the top-level rendering
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

  return (
    <div className="space-y-3 px-6 pb-6">
      {Object.entries(topLevelSchema).map(([path, schemaItem]) => (
        <ParameterRow
          key={path}
          path={path}
          schemaItem={schemaItem as SchemaItem}
          dynamicValues={dynamicValues}
          errors={errors}
          onAddDynamicValue={handleAddDynamicValue}
          onRemoveDynamicValue={handleRemoveDynamicValue}
        />
      ))}
    </div>
  );
};
