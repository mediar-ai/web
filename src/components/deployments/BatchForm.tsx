'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CornerDownLeft, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

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

const CheckboxListField = ({ 
  options, 
  selectedValues, 
  onToggle,
  disabled = false 
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
        onChange={(e) => setSearchTerm(e.target.value)}
        className="mb-2 h-6 text-xs border-black"
        disabled={disabled}
      />
      <div className="max-h-48 overflow-y-auto border border-black rounded p-2 bg-gray-50">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-gray-600 font-medium">
            {selectedValues.length} of {options.length} selected
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSelectAll}
              disabled={disabled || selectedValues.length === options.length}
              className="h-5 px-2 text-xs border-black hover:bg-gray-100"
            >
              All
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDeselectAll}
              disabled={disabled || selectedValues.length === 0}
              className="h-5 px-2 text-xs border-black hover:bg-gray-100"
            >
              None
            </Button>
          </div>
        </div>
        {filteredOptions.length > 0 ? (
          filteredOptions.map(option => {
            const isSelected = selectedValues.some(v => String(v) === option.value);
            return (
              <label 
                key={option.value} 
                className="flex items-center gap-2 p-1 hover:bg-gray-100 cursor-pointer text-xs rounded"
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => onToggle(option.value, e.target.checked)}
                  disabled={disabled}
                  className="h-3 w-3"
                />
                <span className={isSelected ? 'font-medium' : ''}>{option.label}</span>
              </label>
            );
          })
        ) : (
          <div className="text-xs text-gray-500 p-2 text-center">
            {searchTerm ? 'No options match your search' : 'No options available'}
          </div>
        )}
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
      const unselectedOptions = schema.options.filter((option: { value: string; label: string }) => 
        !values.some(v => String(v) === option.value)
      );

      const handleSelectAllAvailable = () => {
        unselectedOptions.forEach((option: { value: string; label: string }) => {
          const err = onAddValue(path, option.value);
          if (err) setInputError(err);
        });
      };

      return (
        <div className="w-56">
          <div className="flex gap-1 mb-1">
            <Select onValueChange={handleSelectAndAdd} value="" disabled={disabled}>
              <SelectTrigger className="flex-1 h-6 text-xs font-mono border-black" size="sm">
                <SelectValue placeholder="Select a value..." />
              </SelectTrigger>
              <SelectContent>
                {schema.options.map((option: { value: string; label: string }, index: number) => {
                  const isSelected = values.some(v => String(v) === option.value);
                  return (
                    <SelectItem
                      key={`${path}-option-${option.value}-${index}`}
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
            <Button
              size="sm"
              variant="outline"
              onClick={handleSelectAllAvailable}
              disabled={disabled || unselectedOptions.length === 0}
              className="h-6 px-2 text-xs border-black hover:bg-gray-100 flex-shrink-0"
              title={`Select all ${unselectedOptions.length} remaining options`}
            >
              All
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="w-56 flex gap-1">
        <Input
          type={schema.type === 'number' ? 'number' : 'text'}
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddValue()}
          className="flex-1 h-6 text-xs font-mono border-black"
          placeholder={placeholder}
          disabled={disabled}
        />
        <Button size="icon" variant="outline" onClick={handleAddValue} className="h-6 w-6 flex-shrink-0 border-black p-1" disabled={disabled}>
          <CornerDownLeft className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  // Special layout for checkbox-list fields - no need for tag display
  if (schema.type === 'checkbox-list') {
    return (
      <div className="grid grid-cols-3 gap-3 items-start">
        <Label htmlFor={path} className="text-sm font-medium text-gray-700 pt-0.5 col-span-1">{label}:</Label>
        <div className="col-span-2 flex flex-col items-start gap-1.5">
          {renderDynamicInput()}
          {inputError && <p className="text-red-500 text-xs">{inputError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3 items-start">
      <Label htmlFor={path} className="text-sm font-medium text-gray-700 pt-0.5 col-span-1">{label}:</Label>
      <div className="col-span-2 flex flex-col items-end gap-1.5">
        <div className="w-full flex-1 flex items-center gap-2">
            <div className="flex flex-wrap gap-1 flex-1">
                {values.map((val, index) => (
                <div key={`${path}-${val}-${index}`} className={`relative group flex items-center gap-1 bg-gray-100 hover:bg-gray-200 rounded-md px-1.5 py-0.5 text-xs transition-colors border ${error ? 'border-red-500' : 'border-black'}`}>
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
              <div key={`${path}-branch-${branchValue}`}>
                <h4 className={`text-sm font-medium mb-1.5 ${isSelected ? 'text-gray-800' : 'text-gray-400'}`}>{branchValue}</h4>
                <div className="pl-3 space-y-3">
                {isSelected && Object.entries(branchControls).map(([branchParamName, branchParamDef]) => (
                    <ParameterRow
                      key={`${path}-${branchValue}-${branchParamName}`}
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
    
    console.log('[SUCCESS] BatchForm: Filtered dynamic parameters:', filtered_dynamic_parameters);

    const calculateConditionalCombinations = (params: Record<string, JsonValue[]>): number => {
      let totalCombinations = 0;
      const controlVariables = Object.keys(schema).filter(k => (schema[k] as SchemaItem).controls);
      
      if (controlVariables.length > 0) {
        const controlVar = controlVariables[0];
        const controlValues = params[controlVar] || [];

        if (controlValues.length === 0) return 1;

        // Find all parameters that are controlled by any branch
        const allControlledParams = new Set<string>();
        for (const branch of Object.values((schema[controlVar] as SchemaItem).controls!)) {
          Object.keys(branch).forEach(key => allControlledParams.add(key));
        }

        // Find global parameters (not controlled by any branch)
        const globalParams = Object.keys(params).filter(key => 
          key !== controlVar && !allControlledParams.has(key)
        );

        controlValues.forEach(cVal => {
          let branchCombinations = 1;
          
          // Multiply by global parameters (parameters not controlled by any branch)
          globalParams.forEach(key => {
            const values = params[key];
            if (values && values.length > 0) {
              const schemaItem = schema[key] as SchemaItem;
              // Checkbox fields contribute 1 combination (all selected values are one parameter)
              // Other field types contribute values.length combinations (each value is separate)
              if (schemaItem && schemaItem.type === 'checkbox-list') {
                branchCombinations *= 1;
                console.log(`🔍 Global checkbox field ${key}: contributing 1 combination (${values.length} selected values)`);
              } else {
              branchCombinations *= values.length;
                console.log(`🔍 Global ${schemaItem?.type || 'field'} ${key}: contributing ${values.length} combinations`);
              }
            }
          });
          
          // Multiply by this branch's specific parameters
          const branchParams = (schema[controlVar] as SchemaItem).controls![cVal as string];
          if (branchParams) {
            Object.keys(branchParams).forEach(bpKey => {
              const values = params[bpKey];
              if (values && values.length > 0) {
                const branchSchemaItem = branchParams[bpKey];
                // Checkbox fields contribute 1 combination (all selected values are one parameter)
                // Other field types contribute values.length combinations (each value is separate)
                if (branchSchemaItem && branchSchemaItem.type === 'checkbox-list') {
                  branchCombinations *= 1;
                  console.log(`🔍 Branch checkbox field ${bpKey}: contributing 1 combination (${values.length} selected values)`);
                } else {
                branchCombinations *= values.length;
                  console.log(`🔍 Branch ${branchSchemaItem?.type || 'field'} ${bpKey}: contributing ${values.length} combinations`);
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
            // Checkbox fields contribute 1 combination (all selected values are one parameter)
            // Other field types contribute values.length combinations (each value is separate)
            if (schemaItem && schemaItem.type === 'checkbox-list') {
              totalCombinations *= 1;
              console.log(`🔍 Checkbox field ${key}: contributing 1 combination (${values.length} selected values)`);
            } else {
            totalCombinations *= values.length;
              console.log(`🔍 ${schemaItem?.type || 'Field'} ${key}: contributing ${values.length} combinations`);
            }
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
