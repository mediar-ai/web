'use server';

import { FunctionDeclarationSchema, SchemaType } from '@google-cloud/vertexai';

// Schema for WORKFLOW_SYNTHESIS_PROMPT
export const WORKFLOW_SYNTHESIS_SCHEMA: FunctionDeclarationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    workflows: {
      type: SchemaType.ARRAY,
      description: 'An array of synthesized workflows.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: {
            type: SchemaType.STRING,
            description: 'The high-level, descriptive name of the workflow.',
          },
          description: {
            type: SchemaType.STRING,
            description: 'A brief, one-sentence summary of what this workflow accomplishes.',
          },
          workflow_types: {
            type: SchemaType.ARRAY,
            description: 'Different variations or classifications of this workflow.',
            items: {
              type: SchemaType.OBJECT,
              properties: {
                type_name: {
                  type: SchemaType.STRING,
                  description: 'The name of the workflow variation, e.g., "Standard Path" or "Exception Case".'
                },
                type_description: {
                  type: SchemaType.STRING,
                  description: 'A brief description of what defines this workflow type.'
                },
                conditions: {
                  type: SchemaType.OBJECT,
                  description: 'A set of key-value pairs describing the conditions that trigger this workflow type.'
                }
              },
              required: ['type_name', 'type_description', 'conditions']
            }
          },
          workflow_instances: {
            type: SchemaType.ARRAY,
            description: 'Specific, concrete examples of this workflow being executed, derived from the event log.',
            items: {
              type: SchemaType.OBJECT,
              properties: {
                instance_name: {
                  type: SchemaType.STRING,
                  description: 'A descriptive name for the specific instance, e.g., "Order #12345" or "John Doe - Initial Onboarding".'
                },
                instance_data: {
                  type: SchemaType.OBJECT,
                  description: 'A set of key-value pairs with structured data about this specific instance.'
                }
              },
              required: ['instance_name', 'instance_data']
            }
          },
          steps: {
            type: SchemaType.ARRAY,
            description: 'The sequence of high-level steps that make up the entire workflow.',
            items: {
              type: SchemaType.OBJECT,
              properties: {
                step_name: {
                  type: SchemaType.STRING,
                  description: 'The descriptive name of the high-level step.',
                },
                substeps: {
                  type: SchemaType.ARRAY,
                  description: 'The granular, detailed sub-steps that compose this high-level step.',
                  items: {
                    type: SchemaType.OBJECT,
                    properties: {
                      substep_name: {
                        type: SchemaType.STRING,
                        description: 'The descriptive name of the granular action or sub-step.'
                      },
                      inputs: {
                        type: SchemaType.ARRAY,
                        items: { type: SchemaType.STRING },
                        description: 'The specific inputs, data, or user actions that trigger this sub-step.',
                      },
                      outputs: {
                        type: SchemaType.ARRAY,
                        items: { type: SchemaType.STRING },
                        description: 'The specific outputs, results, or system changes that occur after this sub-step.',
                      },
                      business_logic: {
                        type: SchemaType.ARRAY,
                        items: { type: SchemaType.STRING },
                        description: 'The rules, conditions, or logic governing this sub-step.',
                      },
                    },
                    required: ['substep_name', 'inputs', 'outputs', 'business_logic'],
                  },
                },
              },
              required: ['step_name', 'substeps'],
            },
          },
        },
        required: ['title', 'description', 'workflow_types', 'workflow_instances', 'steps'],
      },
    },
  },
  required: ['workflows'],
}; 