import { MCPToolsCollection, OpenAITool } from '../types';

export const MOCK_MCP_TOOLS: MCPToolsCollection = {
  get_current_time: {
    description: 'Gets the current date and time',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Timezone to use (e.g., "UTC", "America/New_York")',
            default: 'UTC',
          },
          format: {
            type: 'string',
            description: 'Time format (e.g., "ISO", "readable")',
            default: 'ISO',
          },
        },
        additionalProperties: false,
      },
    },
  },

  take_screenshot: {
    description: 'Takes a screenshot of the desktop or specific element',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'Element selector or "desktop" for full screenshot',
          },
          filename: {
            type: 'string',
            description: 'Optional filename for the screenshot',
            default: 'screenshot.png',
          },
        },
        required: ['selector'],
        additionalProperties: false,
      },
    },
  },

  calculate: {
    description: 'Performs basic mathematical calculations',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description:
              'Mathematical expression to evaluate (e.g., "2 + 3 * 4")',
          },
        },
        required: ['expression'],
        additionalProperties: false,
      },
    },
  },

  get_weather: {
    description: 'Gets weather information for a location',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name or coordinates',
          },
          units: {
            type: 'string',
            description: 'Temperature units (celsius, fahrenheit)',
            default: 'celsius',
          },
        },
        required: ['location'],
        additionalProperties: false,
      },
    },
  },

  search_web: {
    description: 'Searches the web for information',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query string',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results',
            default: 10,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
};

export const MINIMAL_MCP_TOOLS: MCPToolsCollection = {
  get_current_time: MOCK_MCP_TOOLS.get_current_time,
  calculate: MOCK_MCP_TOOLS.calculate,
};

export const INVALID_MCP_TOOLS = {
  broken_tool: {
    // Missing description
    inputSchema: 'invalid schema format',
  },
  incomplete_tool: {
    description: 'A tool missing input schema',
    // Missing inputSchema
  },
};

export const COMPLEX_MCP_TOOLS: MCPToolsCollection = {
  ...MOCK_MCP_TOOLS,

  // App automation tools for multi-step workflows
  get_applications: {
    description: 'Gets a list of currently running applications',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          include_tree: {
            type: 'boolean',
            description: 'Whether to include UI tree for each application',
            default: false,
          },
        },
        additionalProperties: false,
      },
    },
  },

  open_application: {
    description: 'Opens or activates an application by name',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          app_name: {
            type: 'string',
            description:
              'Name of the application to open (e.g., "Cursor", "Chrome", "VSCode")',
          },
        },
        required: ['app_name'],
        additionalProperties: false,
      },
    },
  },

  get_window_tree: {
    description: 'Gets the UI tree structure of a window or application',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          pid: {
            type: 'number',
            description: 'Process ID of the target application (optional)',
          },
          title: {
            type: 'string',
            description: 'Window title filter (optional)',
          },
        },
        additionalProperties: false,
      },
    },
  },

  get_focused_window_tree: {
    description: 'Gets the UI tree for the currently focused window',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },

  click_element: {
    description: 'Clicks a UI element using a selector',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'UI element selector (e.g., role:Button|name:Submit)',
          },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in milliseconds',
            default: 3000,
          },
        },
        required: ['selector'],
        additionalProperties: false,
      },
    },
  },

  type_into_element: {
    description: 'Types text into a UI element like an input field',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'UI element selector for the input field',
          },
          text_to_type: {
            type: 'string',
            description: 'Text to type into the element',
          },
          clear_before_typing: {
            type: 'boolean',
            description: 'Whether to clear the element before typing',
            default: true,
          },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in milliseconds',
            default: 3000,
          },
        },
        required: ['selector', 'text_to_type'],
        additionalProperties: false,
      },
    },
  },

  validate_element: {
    description:
      'Validates that an element exists and provides information about it',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'UI element selector to validate',
          },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in milliseconds',
            default: 3000,
          },
        },
        required: ['selector'],
        additionalProperties: false,
      },
    },
  },

  wait_for_element: {
    description: 'Waits for an element to meet a specific condition',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'UI element selector to wait for',
          },
          condition: {
            type: 'string',
            enum: ['visible', 'enabled', 'focused', 'exists'],
            description: 'Condition to wait for',
          },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in milliseconds',
            default: 10000,
          },
        },
        required: ['selector', 'condition'],
        additionalProperties: false,
      },
    },
  },

  file_operations: {
    description: 'Performs file system operations',
    inputSchema: {
      jsonSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['read', 'write', 'delete', 'list'],
            description: 'Type of file operation to perform',
          },
          path: {
            type: 'string',
            description: 'File or directory path',
          },
          content: {
            type: 'string',
            description: 'Content to write (only for write operation)',
          },
        },
        required: ['operation', 'path'],
        additionalProperties: false,
      },
    },
  },
};

// OpenAI-compatible tool definitions for testing
export const OPENAI_TOOLS: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Gets the current date and time',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Timezone to use (e.g., "UTC", "America/New_York")',
          },
          format: {
            type: 'string',
            description: 'Time format (e.g., "ISO", "readable")',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Takes a screenshot of the desktop or specific element',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'Element selector or "desktop" for full screenshot',
          },
          filename: {
            type: 'string',
            description: 'Optional filename for the screenshot',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Performs basic mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description:
              'Mathematical expression to evaluate (e.g., "2 + 3 * 4")',
          },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Gets weather information for a location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name or coordinates',
          },
          units: {
            type: 'string',
            description: 'Temperature units (celsius, fahrenheit)',
          },
        },
        required: ['location'],
      },
    },
  },
];

export const MINIMAL_OPENAI_TOOLS: OpenAITool[] = [
  OPENAI_TOOLS[0], // get_current_time
  OPENAI_TOOLS[2], // calculate
];

export const COMPLEX_OPENAI_TOOLS: OpenAITool[] = [
  ...OPENAI_TOOLS,
  {
    type: 'function',
    function: {
      name: 'get_applications',
      description: 'Gets a list of currently running applications',
      parameters: {
        type: 'object',
        properties: {
          include_tree: {
            type: 'boolean',
            description: 'Whether to include UI tree for each application',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_application',
      description: 'Opens or activates an application by name',
      parameters: {
        type: 'object',
        properties: {
          app_name: {
            type: 'string',
            description:
              'Name of the application to open (e.g., "Cursor", "Chrome", "VSCode")',
          },
        },
        required: ['app_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_window_tree',
      description: 'Gets the UI tree structure of a window or application',
      parameters: {
        type: 'object',
        properties: {
          pid: {
            type: 'number',
            description: 'Process ID of the target application (optional)',
          },
          title: {
            type: 'string',
            description: 'Window title filter (optional)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_focused_window_tree',
      description: 'Gets the UI tree for the currently focused window',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_element',
      description: 'Clicks a UI element using a selector',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'UI element selector (e.g., role:Button|name:Submit)',
          },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in milliseconds',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_into_element',
      description: 'Types text into a UI element like an input field',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'UI element selector for the input field',
          },
          text_to_type: {
            type: 'string',
            description: 'Text to type into the element',
          },
          clear_before_typing: {
            type: 'boolean',
            description: 'Whether to clear the element before typing',
          },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in milliseconds',
          },
        },
        required: ['selector', 'text_to_type'],
      },
    },
  },
];
