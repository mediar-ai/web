/**
 * Converts JSON Schema (used by MCP) to Vertex AI function declaration format
 * 
 * Vertex AI doesn't support:
 * - $schema, $ref, definitions
 * - anyOf, oneOf, allOf (use simplified type)
 * - const (convert to enum with single value)
 */

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, any>;
  required?: string[];
  items?: any;
  enum?: any[];
  const?: any;
  anyOf?: any[];
  oneOf?: any[];
  allOf?: any[];
  $ref?: string;
  $schema?: string;
  definitions?: Record<string, any>;
  [key: string]: any;
}

/**
 * Recursively clean and convert JSON Schema to Vertex AI format
 */
export function convertToVertexSchema(schema: JsonSchema): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  // Handle $ref by returning a basic object type
  if (schema.$ref) {
    return { type: 'object' };
  }

  // Handle anyOf/oneOf/allOf - use first option or merge
  if (schema.anyOf || schema.oneOf || schema.allOf) {
    const options = schema.anyOf || schema.oneOf || schema.allOf || [];
    if (options.length > 0) {
      // Use first non-const option, or merge all options
      const firstOption = options.find((opt: any) => !opt.const) || options[0];
      return convertToVertexSchema(firstOption);
    }
  }

  // Handle const by converting to enum
  if (schema.const !== undefined) {
    return {
      type: typeof schema.const,
      enum: [schema.const],
    };
  }

  const result: any = {};

  // Copy type
  if (schema.type) {
    // Vertex AI doesn't support array of types, pick first one
    result.type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  }

  // Convert properties recursively
  if (schema.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = convertToVertexSchema(value);
    }
  }

  // Copy required fields
  if (schema.required && Array.isArray(schema.required)) {
    result.required = schema.required;
  }

  // Handle arrays
  if (schema.items) {
    result.items = convertToVertexSchema(schema.items);
  }

  // Copy enum
  if (schema.enum) {
    result.enum = schema.enum;
  }

  // Copy description
  if (schema.description) {
    result.description = schema.description;
  }

  // Copy format
  if (schema.format) {
    result.format = schema.format;
  }

  // Copy default
  if (schema.default !== undefined) {
    result.default = schema.default;
  }

  // Explicitly ignore JSON Schema specific fields
  // $schema, $ref, definitions, anyOf, oneOf, allOf, const are not copied

  return result;
}

/**
 * Convert MCP tool to Vertex AI function declaration
 */
export function convertMcpToolToVertex(tool: {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}): {
  name: string;
  description: string;
  parameters: any;
} {
  return {
    name: tool.name,
    description: tool.description || `Execute ${tool.name}`,
    parameters: tool.inputSchema 
      ? convertToVertexSchema(tool.inputSchema)
      : { type: 'object', properties: {} },
  };
}
