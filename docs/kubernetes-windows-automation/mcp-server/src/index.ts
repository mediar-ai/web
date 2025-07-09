import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { spawn } from 'child_process';
import winston from 'winston';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'C:\\logs\\mcp-server.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Express app for HTTP endpoint
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Ready check endpoint
app.get('/ready', (req, res) => {
  // Check if terminator is accessible
  const terminatorPath = process.env.TERMINATOR_PATH || 'C:\\terminator';
  fs.access(terminatorPath)
    .then(() => res.json({ status: 'ready', terminator: 'available' }))
    .catch(() => res.status(503).json({ status: 'not ready', terminator: 'unavailable' }));
});

// MCP Server setup
const server = new Server(
  {
    name: 'windows-automation-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Define available tools
const TOOLS = [
  {
    name: 'execute_workflow',
    description: 'Execute a Windows automation workflow using terminator',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Array of workflow items to execute'
        },
        variables: {
          type: 'object',
          description: 'Variables to use in the workflow'
        }
      },
      required: ['items']
    }
  },
  {
    name: 'capture_screenshot',
    description: 'Capture a screenshot of the current screen',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Filename for the screenshot'
        }
      }
    }
  },
  {
    name: 'get_ui_tree',
    description: 'Get the current UI automation tree',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'Optional selector to filter the tree'
        }
      }
    }
  }
];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  logger.info(`Executing tool: ${name}`, { args });
  
  try {
    switch (name) {
      case 'execute_workflow':
        return await executeWorkflow(args);
      
      case 'capture_screenshot':
        return await captureScreenshot(args);
      
      case 'get_ui_tree':
        return await getUITree(args);
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error(`Tool execution failed: ${name}`, error);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error.message
        })
      }]
    };
  }
});

// Execute workflow using terminator
async function executeWorkflow(args: any) {
  const terminatorPath = process.env.TERMINATOR_PATH || 'C:\\terminator';
  const workflowFile = path.join('C:\\temp', `workflow_${Date.now()}.json`);
  
  try {
    // Write workflow to temp file
    await fs.writeFile(workflowFile, JSON.stringify(args));
    
    // Execute terminator
    const result = await new Promise((resolve, reject) => {
      const proc = spawn('node', [
        path.join(terminatorPath, 'dist', 'cli.js'),
        'execute',
        '--workflow', workflowFile,
        '--format', 'json'
      ], {
        cwd: terminatorPath
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => stdout += data.toString());
      proc.stderr.on('data', (data) => stderr += data.toString());
      
      proc.on('close', (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            resolve({ success: true, output: stdout });
          }
        } else {
          reject(new Error(`Terminator failed with code ${code}: ${stderr}`));
        }
      });
    });
    
    // Clean up temp file
    await fs.unlink(workflowFile).catch(() => {});
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          result
        })
      }]
    };
  } catch (error) {
    // Clean up temp file on error
    await fs.unlink(workflowFile).catch(() => {});
    throw error;
  }
}

// Capture screenshot
async function captureScreenshot(args: any) {
  const screenshotDir = 'C:\\screenshots';
  const filename = args.filename || `screenshot_${Date.now()}.png`;
  const filepath = path.join(screenshotDir, filename);
  
  // Ensure directory exists
  await fs.mkdir(screenshotDir, { recursive: true });
  
  // Use terminator's screenshot capability
  const terminatorPath = process.env.TERMINATOR_PATH || 'C:\\terminator';
  
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [
      path.join(terminatorPath, 'dist', 'cli.js'),
      'screenshot',
      '--output', filepath
    ], {
      cwd: terminatorPath
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              filepath,
              filename
            })
          }]
        });
      } else {
        reject(new Error(`Screenshot capture failed with code ${code}`));
      }
    });
  });
}

// Get UI tree
async function getUITree(args: any) {
  const terminatorPath = process.env.TERMINATOR_PATH || 'C:\\terminator';
  const selector = args.selector || '';
  
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [
      path.join(terminatorPath, 'dist', 'cli.js'),
      'inspect',
      '--format', 'json',
      ...(selector ? ['--selector', selector] : [])
    ], {
      cwd: terminatorPath
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());
    
    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const tree = JSON.parse(stdout);
          resolve({
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                tree
              })
            }]
          });
        } catch (e) {
          reject(new Error(`Failed to parse UI tree: ${e.message}`));
        }
      } else {
        reject(new Error(`UI tree inspection failed with code ${code}: ${stderr}`));
      }
    });
  });
}

// Start MCP server with stdio transport
async function startMCPServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server started with stdio transport');
}

// Start express server for HTTP endpoints
function startHTTPServer() {
  const port = parseInt(process.env.MCP_PORT || '3000');
  
  // Add MCP endpoint for HTTP/SSE
  app.post('/mcp', async (req, res) => {
    try {
      // Handle MCP protocol over HTTP
      const { method, params, id } = req.body;
      
      // Set session ID in response header
      const sessionId = req.headers['mcp-session-id'] || 
                       `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      res.setHeader('Mcp-Session-Id', sessionId);
      
      // Route to appropriate handler
      let result;
      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: server.capabilities,
            serverInfo: {
              name: server.serverInfo.name,
              version: server.serverInfo.version
            }
          };
          break;
          
        case 'notifications/initialized':
          res.status(202).send();
          return;
          
        case 'tools/list':
          result = await server.handleRequest({ method, params: params || {} });
          break;
          
        case 'tools/call':
          result = await server.handleRequest({ method, params });
          break;
          
        default:
          throw new Error(`Unknown method: ${method}`);
      }
      
      // Send SSE format response
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`);
      res.end();
      
    } catch (error) {
      logger.error('MCP HTTP request failed:', error);
      res.status(500).json({
        jsonrpc: '2.0',
        id: req.body.id,
        error: {
          code: -32603,
          message: error.message
        }
      });
    }
  });
  
  app.listen(port, '0.0.0.0', () => {
    logger.info(`HTTP server listening on port ${port}`);
  });
}

// Start both servers
async function main() {
  try {
    // Start MCP server if not in HTTP-only mode
    if (process.env.MCP_MODE !== 'http-only') {
      await startMCPServer();
    }
    
    // Start HTTP server
    startHTTPServer();
    
    logger.info('Windows automation MCP server started successfully');
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();