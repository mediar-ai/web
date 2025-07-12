'use client';

import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, CornerDownLeft } from 'lucide-react';

type JsonValue = string | number | boolean | { [x: string]: JsonValue } | Array<JsonValue> | null;
type JsonObject = { [x:string]: JsonValue };

// Define proper types for schema items
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
  path,
  value,
  schemaItem,
  dynamicErrors,
  onAddDynamicValue,
  onRemoveDynamicValue,
}: {
  path: string;
  value: JsonValue[];
  schemaItem: SchemaItem;
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

// New component for rendering parameters with hierarchy
const ParameterRow = ({
  path,
  schemaItem,
  level,
  dynamicValues,
  errors,
  onAddDynamicValue,
  onRemoveDynamicValue,
}: {
  path: string;
  schemaItem: Record<string, unknown>;
  level: number;
  dynamicValues: Record<string, JsonValue[]>;
  errors: Record<string, string>;
  onAddDynamicValue: (path: string, value: string) => string | undefined;
  onRemoveDynamicValue: (path: string, index: number) => void;
}) => {
  if (level === 0) {
    // Top-level parameters - no indentation
    return (
      <div key={path} className="mb-4">
        <ParameterField
          path={path}
          value={dynamicValues[path] || []}
          schemaItem={schemaItem as SchemaItem}
          dynamicErrors={errors}
          onAddDynamicValue={onAddDynamicValue}
          onRemoveDynamicValue={onRemoveDynamicValue}
        />
      </div>
    );
  } else if (level === 1) {
    // Branch headers - 24px indentation
    return (
      <div key={path} style={{ marginLeft: '24px' }} className="mb-4">
        <div className="text-sm font-medium text-gray-700 mb-2">{String(path)}:</div>
        {schemaItem.controls && typeof schemaItem.controls === 'object' ? (
          <div>
            {Object.entries(schemaItem.controls as Record<string, Record<string, unknown>>).map(([branchValue, branchControls]) => {
              const selectedValues = dynamicValues[path] || [];
              const isSelected = selectedValues.includes(branchValue);
              
              return (
                <div key={branchValue} style={{ marginLeft: '24px' }} className="mb-4">
                  <div className={`text-sm font-medium mb-2 ${isSelected ? 'text-gray-700' : 'text-gray-400'}`}>
                    {String(branchValue)}:
                  </div>
                  {Object.entries(branchControls).map(([branchParamName, branchParamDef]) => (
                    <div key={branchParamName} style={{ marginLeft: '24px' }} className="mb-4">
                      <ParameterField
                        path={branchParamName}
                        value={dynamicValues[branchParamName] || []}
                        schemaItem={branchParamDef as SchemaItem}
                        dynamicErrors={errors}
                        onAddDynamicValue={onAddDynamicValue}
                        onRemoveDynamicValue={onRemoveDynamicValue}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }
  
  return null;
};

export function BatchForm({ schema, initialValues, onSpecChange, onCombinationsChange, initialSpec }: BatchFormProps) {
  const initializeDynamicValues = () => {
    if (initialSpec && Object.keys(initialSpec.dynamic_parameters).length > 0) {
      return initialSpec.dynamic_parameters;
    }
    // Flatten schema to get all leaf parameters
    const flatSchema = flattenSchema(schema);
    const flatInitialValues = flattenSchema(initialValues);
    
    const initialDynamic: Record<string, JsonValue[]> = {};
    
    // First, initialize all regular parameters
    Object.keys(flatSchema).forEach(path => {
        const initialValue = flatInitialValues[path]?.default ?? flatSchema[path]?.default;
        initialDynamic[path] = initialValue !== undefined && initialValue !== null ? [initialValue] : [];
    });
    
    // Then, initialize only the default branch parameters for conditional logic
    Object.entries(schema).forEach(([, controlSchema]) => {
      if (controlSchema && typeof controlSchema === 'object' && (controlSchema as SchemaItem).controls) {
        const controls = (controlSchema as SchemaItem).controls;
        
        // Get the default branch value
        const defaultBranchValue = (controlSchema as SchemaItem).default || Object.keys(controls || {})[0];
        
        // Only initialize parameters for the default branch
        if (controls && controls[defaultBranchValue as string]) {
          Object.entries(controls[defaultBranchValue as string]).forEach(([paramName, paramDef]) => {
            if (!initialDynamic[paramName] || initialDynamic[paramName].length === 0) {
              const defaultValue = paramDef.default;
              if (defaultValue !== undefined && defaultValue !== null) {
                initialDynamic[paramName] = [defaultValue];
              }
            }
          });
        }
      }
    });
    
    return initialDynamic;
  };

  const [dynamicValues, setDynamicValues] = useState<Record<string, JsonValue[]>>(initializeDynamicValues);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateValue = (path: string, value: string): string | undefined => {
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
  }, [dynamicValues, schema, validateValue]);

  const handleAddDynamicValue = (path: string, value: string) => {
    if (!value) return;
    const error = validateValue(path, value);
    if (error) {
      return error;
    }
    
    // Check if this is a controlling parameter (has conditional branches)
    const controlSchema = schema[path];
    if (controlSchema && typeof controlSchema === 'object' && (controlSchema as SchemaItem).controls) {
      const controls = (controlSchema as SchemaItem).controls;
      
      // If we're adding a new branch value, initialize its parameters with defaults
      if (controls && controls[value]) {
        setDynamicValues(prev => {
          const newDynamic = { ...prev };
          
          // Add the controlling parameter value
          newDynamic[path] = [...(prev[path] || []), value];
          
          // Initialize default values for parameters in this branch
          Object.entries(controls[value]).forEach(([paramName, paramDef]) => {
            if (!newDynamic[paramName] || newDynamic[paramName].length === 0) {
              const defaultValue = paramDef.default;
              if (defaultValue !== undefined && defaultValue !== null) {
                newDynamic[paramName] = [defaultValue];
              }
            }
          });
          
          return newDynamic;
        });
      } else {
        // Regular controlling parameter addition
        setDynamicValues(prev => ({ ...prev, [path]: [...(prev[path] || []), value] }));
      }
    } else {
      // Regular parameter addition
      setDynamicValues(prev => ({ ...prev, [path]: [...(prev[path] || []), value] }));
    }
    
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
    // Filter dynamic_parameters based on active choices for conditional variables
    const filtered_dynamic_parameters: Record<string, JsonValue[]> = {};
    
    // Helper function to check if a variable should be included
    const shouldIncludeVariable = (variablePath: string): boolean => {
      // Check if this variable belongs to a conditional branch
      for (const [controlPath, controlSchema] of Object.entries(schema)) {
        if (controlSchema && typeof controlSchema === 'object' && (controlSchema as SchemaItem).controls) {
          const selectedValues = dynamicValues[controlPath] || [];
          const controls = (controlSchema as SchemaItem).controls;
          
          // If this is the controlling parameter itself, always include it if it has values
          if (variablePath === controlPath) {
            return selectedValues.length > 0;
          }
          
          // Check if this variable is in any of the selected branches
          for (const selectedValue of selectedValues) {
            const branchControls = controls?.[selectedValue as string];
            if (branchControls && branchControls[variablePath]) {
              return true;
            }
          }
          
          // Check if this variable is a branch-specific parameter
          // If it is, but not in any selected branch, exclude it
          if (controls) {
            for (const [, branchControls] of Object.entries(controls)) {
              if (branchControls && typeof branchControls === 'object' && branchControls[variablePath]) {
                // This is a branch-specific parameter, but not in selected branches
                return false;
              }
            }
          }
        }
      }
      
      // If not part of any conditional logic, include it
      return true;
    };

    // Apply filtering logic
    Object.entries(dynamicValues).forEach(([path, values]) => {
      if (values.length > 0 && shouldIncludeVariable(path)) {
        filtered_dynamic_parameters[path] = values;
      }
    });

    // Calculate combinations with conditional logic awareness
    const calculateConditionalCombinations = (params: Record<string, JsonValue[]>): number => {
      const keys = Object.keys(params);
      if (keys.length === 0) return 0;

      // Check if we have conditional logic (branch-specific parameters)
      const controllingParams: Record<string, JsonValue[]> = {};
      const branchSpecificParams: Record<string, string[]> = {}; // Maps controlling param values to their branch-specific param names
      const regularParams: Record<string, JsonValue[]> = {};

      // Identify controlling parameters and their branch-specific parameters
      for (const [paramName, paramValues] of Object.entries(params)) {
        // Look for parameters that have branch-specific variants
        // For example: quote_type controls quote_value_face_value and quote_value_max_monthly_budget
        
        // Check if there are parameters that follow the pattern: {base}_{branch_value}
        // where {base} is derived from this parameter's name and {branch_value} matches one of this parameter's values
        const hasBranchSpecific = paramValues.some(value => {
          const normalizedValue = (value as string).toLowerCase().replace(/\s+/g, '_');
          // Look for parameters that end with this normalized value
          return keys.some(key => 
            key !== paramName && 
            key.toLowerCase().endsWith('_' + normalizedValue)
          );
        });
        
        if (hasBranchSpecific) {
          // This is a controlling parameter
          controllingParams[paramName] = paramValues;
          
          // Find all branch-specific parameters for this controlling parameter
          paramValues.forEach(value => {
            const normalizedValue = (value as string).toLowerCase().replace(/\s+/g, '_');
            
            // Find parameters that end with this normalized value
            const matchingBranchParams = keys.filter(key => 
              key !== paramName && 
              key.toLowerCase().endsWith('_' + normalizedValue)
            );
            
            if (matchingBranchParams.length > 0) {
              if (!branchSpecificParams[value as string]) {
                branchSpecificParams[value as string] = [];
              }
              branchSpecificParams[value as string].push(...matchingBranchParams);
            }
          });
        } else {
          // Check if this is a branch-specific parameter
          const isBranchSpecific = Object.values(branchSpecificParams).some(branchParams =>
            branchParams.includes(paramName)
          );
          
          if (!isBranchSpecific) {
            // This is a regular parameter
            regularParams[paramName] = paramValues;
          }
        }
      }

      if (Object.keys(controllingParams).length > 0) {
        // We have conditional logic - calculate combinations per branch
        let totalCombinations = 0;
        
        Object.entries(controllingParams).forEach(([controlParam, controlValues]) => {
          controlValues.forEach(controlValue => {
            // For this specific branch, calculate combinations
            const branchParams: Record<string, JsonValue[]> = {
              ...regularParams,
              [controlParam]: [controlValue] // Include the controlling parameter with this specific value
            };
            
            // Add branch-specific parameters for this control value
            const branchSpecificParamNames = branchSpecificParams[controlValue as string] || [];
            branchSpecificParamNames.forEach(branchParamName => {
              if (params[branchParamName]) {
                // For calculation purposes, we don't need to map back to original names
                // Just count the combinations for this branch
                branchParams[branchParamName] = params[branchParamName];
              }
            });
            
            // Generate combinations count for this branch
            let branchCombinations = 1;
            Object.values(branchParams).forEach(values => {
              branchCombinations *= values.length;
            });
            
            totalCombinations += branchCombinations;
          });
        });
        
        return totalCombinations;
      } else {
        // No conditional logic, use simple Cartesian product
        let combinations = 1;
        Object.values(params).forEach(values => {
          combinations *= values.length;
        });
        return combinations;
      }
    };

    const totalCombinations = calculateConditionalCombinations(filtered_dynamic_parameters);
    
    // Pass the results to parent component
    const isValid = Object.keys(errors).length === 0;
    onSpecChange({ static_parameters: {}, dynamic_parameters: filtered_dynamic_parameters }, isValid);
    onCombinationsChange(totalCombinations);
  }, [dynamicValues, schema, errors, onSpecChange, onCombinationsChange]);

  return (
    <div className="space-y-0">
      {Object.entries(schema).map(([path, schemaItem]) => (
        <ParameterRow
          key={path}
          path={path}
          schemaItem={schemaItem as Record<string, unknown>}
          level={0}
          dynamicValues={dynamicValues}
          errors={errors}
          onAddDynamicValue={handleAddDynamicValue}
          onRemoveDynamicValue={handleRemoveDynamicValue}
        />
      ))}
    </div>
  );
};
