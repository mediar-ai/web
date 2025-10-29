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
