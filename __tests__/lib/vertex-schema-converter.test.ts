import { convertToVertexSchema, convertMcpToolToVertex } from '@/lib/vertex-schema-converter';

describe('vertex-schema-converter', () => {
  describe('convertToVertexSchema', () => {
    it('should remove $schema field', () => {
      const input = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          name: { type: 'string' }
        }
      };
      
      const result = convertToVertexSchema(input);
      
      expect(result.$schema).toBeUndefined();
      expect(result.type).toBe('object');
      expect(result.properties.name.type).toBe('string');
    });

    it('should convert const to enum', () => {
      const input = {
        type: 'object',
        properties: {
          action: { const: 'click' }
        }
      };
      
      const result = convertToVertexSchema(input);
      
      expect(result.properties.action.const).toBeUndefined();
      expect(result.properties.action.enum).toEqual(['click']);
    });

    it('should handle anyOf by using first option', () => {
      const input = {
        type: 'object',
        properties: {
          value: {
            anyOf: [
              { type: 'string' },
              { type: 'number' }
            ]
          }
        }
      };

      const result = convertToVertexSchema(input);

      expect(result.properties.value.anyOf).toBeUndefined();
      expect(result.properties.value.type).toBe('string');
    });

    it('should filter out unsupported JSON Schema fields', () => {
      const input = {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 100
          },
          enabled: {
            type: 'boolean',
            additionalProperties: false, // Not supported by Vertex AI
            readOnly: true, // Not supported by Vertex AI
          }
        },
        additionalProperties: true, // Not supported at root level
        $schema: 'http://json-schema.org/draft-07/schema#'
      };

      const result = convertToVertexSchema(input);

      // Should keep supported fields
      expect(result.type).toBe('object');
      expect(result.properties.name.type).toBe('string');
      expect(result.properties.name.minLength).toBe(1);
      expect(result.properties.name.maxLength).toBe(100);
      expect(result.properties.enabled.type).toBe('boolean');

      // Should remove unsupported fields
      expect(result.$schema).toBeUndefined();
      expect(result.additionalProperties).toBeUndefined();
      expect(result.properties.enabled.additionalProperties).toBeUndefined();
      expect(result.properties.enabled.readOnly).toBeUndefined();
    });

    it('should skip properties with boolean values (like env: true)', () => {
      // Real-world case from execute_browser_script MCP tool
      const input = {
        type: 'object',
        properties: {
          script: {
            type: 'string',
            nullable: true
          },
          env: true, // ❌ Invalid - should be a schema object, not boolean
          selector: {
            type: 'string',
            description: 'Element selector'
          }
        },
        required: ['selector']
      };

      const result = convertToVertexSchema(input);

      // Should keep valid properties
      expect(result.type).toBe('object');
      expect(result.properties.script).toBeDefined();
      expect(result.properties.script.type).toBe('string');
      expect(result.properties.selector).toBeDefined();
      expect(result.properties.selector.type).toBe('string');
      expect(result.required).toEqual(['selector']);

      // Should skip the boolean property
      expect(result.properties.env).toBeUndefined();
    });

    it('should handle complex nested schemas with multiple invalid properties', () => {
      const input = {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            properties: {
              enabled: {
                type: 'boolean'
              },
              settings: true, // ❌ Invalid boolean
              metadata: {
                type: 'object',
                properties: {
                  tags: {
                    type: 'array',
                    items: { type: 'string' }
                  },
                  extra: false // ❌ Invalid boolean
                },
                additionalProperties: true // ❌ Not supported
              }
            },
            readOnly: true // ❌ Not supported
          },
          data: true // ❌ Invalid boolean
        },
        $schema: 'http://json-schema.org/draft-07/schema#' // ❌ Not supported
      };

      const result = convertToVertexSchema(input);

      // Root level
      expect(result.type).toBe('object');
      expect(result.$schema).toBeUndefined();
      expect(result.properties.data).toBeUndefined(); // Boolean property skipped

      // First nested level
      expect(result.properties.config).toBeDefined();
      expect(result.properties.config.type).toBe('object');
      expect(result.properties.config.readOnly).toBeUndefined(); // Unsupported field
      expect(result.properties.config.properties.enabled).toBeDefined();
      expect(result.properties.config.properties.settings).toBeUndefined(); // Boolean property skipped

      // Second nested level
      expect(result.properties.config.properties.metadata).toBeDefined();
      expect(result.properties.config.properties.metadata.additionalProperties).toBeUndefined(); // Unsupported field
      expect(result.properties.config.properties.metadata.properties.tags).toBeDefined();
      expect(result.properties.config.properties.metadata.properties.tags.type).toBe('array');
      expect(result.properties.config.properties.metadata.properties.extra).toBeUndefined(); // Boolean property skipped
    });

    it('should handle arrays with invalid item schemas', () => {
      const input = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            data: true, // ❌ Invalid boolean
            meta: {
              type: 'object',
              additionalProperties: false // ❌ Not supported
            }
          }
        }
      };

      const result = convertToVertexSchema(input);

      expect(result.type).toBe('array');
      expect(result.items).toBeDefined();
      expect(result.items.properties.id).toBeDefined();
      expect(result.items.properties.data).toBeUndefined(); // Boolean property skipped
      expect(result.items.properties.meta).toBeDefined();
      expect(result.items.properties.meta.additionalProperties).toBeUndefined(); // Unsupported field
    });
  });

  describe('convertMcpToolToVertex', () => {
    it('should convert MCP tool with full schema', () => {
      const mcpTool = {
        name: 'click_element',
        description: 'Click an element',
        inputSchema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: {
            selector: { type: 'string' }
          },
          required: ['selector']
        }
      };
      
      const result = convertMcpToolToVertex(mcpTool);
      
      expect(result.name).toBe('click_element');
      expect(result.parameters.$schema).toBeUndefined();
      expect(result.parameters.type).toBe('object');
    });
  });
});
