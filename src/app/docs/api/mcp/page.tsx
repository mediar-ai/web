'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/ui/code-block';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Menu, X } from 'lucide-react';
import mermaid from 'mermaid';

// Types for MCP tool data
interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      default?: string | number | boolean | string[];
    }>;
    required?: string[];
  };
  metadata?: {
    workflow_id: number;
    estimated_duration_seconds?: number;
  };
}

interface MCPWorkflow {
  name: string;
  description: string;
  workflow_id: number;
  category: string;
  parameters: number;
  estimated_duration_seconds?: number;
  parameter_names: string[];
}

// MCP Protocol endpoints
interface MCPEndpoint {
  id: string;
  method: string;
  description: string;
  requestExample: string;
  responseExample: string;
}

// Utility function to get the proper domain
const getAppDomain = () => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'https://app.mediar.ai';
};

export default function MCPAPIDocsPage() {
  const mermaidRef = useRef<HTMLDivElement>(null);
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [mcpWorkflows, setMcpWorkflows] = useState<MCPWorkflow[]>([]);
  const [loadingTools, setLoadingTools] = useState(true);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string>('overview');
  const [appDomain, setAppDomain] = useState<string>('');
  
  // Copy-to-clipboard state
  const [copiedStates, setCopiedStates] = useState<Record<string, string>>({});
  
  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Set app domain on client side
  useEffect(() => {
    const domain = getAppDomain();
    console.log('[FIX] [MCP Docs] Setting domain:', domain);
    setAppDomain(domain);
  }, []);

  // Memoized URLs that update when domain changes
  const urls = useMemo(() => {
    const domain = appDomain || 'https://app.mediar.ai';
    return {
      mcpEndpoint: `${domain}/api/mcp`,
      healthCheck: `${domain}/api/mcp/health`,
    };
  }, [appDomain]);
  
  // Copy to clipboard utility function
  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStates(prev => ({ ...prev, [key]: 'Copied!' }));
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [key]: '' }));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      setCopiedStates(prev => ({ ...prev, [key]: 'Failed' }));
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [key]: '' }));
      }, 2000);
    }
  };

  useEffect(() => {
    mermaid.initialize({ 
      startOnLoad: true,
      theme: 'neutral',
      themeVariables: {
        primaryColor: '#fff',
        primaryTextColor: '#000',
        primaryBorderColor: '#000',
        lineColor: '#000',
        background: '#fff'
      }
    });
    
    if (mermaidRef.current) {
      mermaid.contentLoaded();
    }
  }, []);

  // Fetch MCP tools and workflows
  useEffect(() => {
    const fetchMCPData = async () => {
      try {
        setLoadingTools(true);
        console.log('Fetching MCP tools for documentation...');
        
        // Fetch tools via MCP API
        const toolsResponse = await fetch('/api/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list'
          })
        });
        
        if (!toolsResponse.ok) {
          throw new Error(`MCP API error: ${toolsResponse.status}`);
        }
        
        const toolsData = await toolsResponse.json();
        
        if (toolsData.error) {
          throw new Error(`MCP error: ${toolsData.error.message}`);
        }
        
        const tools = toolsData.result?.tools || [];
        setMcpTools(tools);
        
        // Also fetch workflow details for additional context
        const workflowsResponse = await fetch('/api/mcp/workflows');
        if (workflowsResponse.ok) {
          const workflowsData = await workflowsResponse.json();
          setMcpWorkflows(workflowsData.workflows || []);
        }
        
        console.log(`[SUCCESS] Successfully loaded ${tools.length} MCP tools`);
        setToolsError(null);
      } catch (error) {
        console.error('[ERROR] Failed to fetch MCP tools:', error);
        setToolsError(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setLoadingTools(false);
      }
    };

    fetchMCPData();
  }, []);

  const mcpEndpoints: MCPEndpoint[] = [
    {
      id: 'initialize',
      method: 'initialize',
      description: 'Initialize the MCP connection and get server capabilities',
      requestExample: `{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "clientInfo": {
      "name": "cursor",
      "version": "1.0.0"
    }
  }
}`,
      responseExample: `{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {
        "listChanged": true
      }
    },
    "serverInfo": {
      "name": "Workflow Automation MCP Server",
      "version": "1.0.0"
    }
  }
}`
    },
    {
      id: 'tools-list',
      method: 'tools/list',
      description: 'List all available automation tools discovered from workflows',
      requestExample: `{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}`,
      responseExample: `{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "insurance_set_available_products",
        "description": "Configuration workflow to enable all available insurance products in Best Plan Pro system for quote generation. This tool executes a browser automation workflow that performs complex tasks automatically.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "execution_mode": {
              "type": "string",
              "enum": ["async", "sync"],
              "default": "async",
              "description": "Execution mode: 'async' returns immediately with execution ID, 'sync' waits for completion"
            },
            "include_cache": {
              "type": "boolean",
              "default": true,
              "description": "Use cached results if available for faster response"
            },
            "products_to_enable": {
              "type": "array",
              "description": "Products to Enable",
              "default": ["Aetna Accendo", "Aetna Individual Whole Life", "American Amicable Clear Choice"]
            }
          }
        }
      }
    ]
  }
}`
    },
    {
      id: 'tools-call',
      method: 'tools/call',
      description: 'Execute a specific workflow tool with parameters',
      requestExample: `{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "insurance_set_available_products",
    "arguments": {
      "execution_mode": "async",
      "include_cache": true,
      "products_to_enable": [
        "Aetna Accendo",
        "Aetna Individual Whole Life",
        "American Amicable Clear Choice"
      ]
    }
  }
}`,
      responseExample: `{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\n  \\"type\\": \\"success\\",\n  \\"data\\": {\n    \\"success\\": true,\n    \\"execution_id\\": 5396,\n    \\"workflow_id\\": 4,\n    \\"workflow_name\\": \\"Set Available Products\\",\n    \\"status\\": \\"queued\\",\n    \\"message\\": \\"Workflow execution queued successfully. Modal will process it within 10 seconds. Use execution ID 5396 to monitor progress.\\"\n  }\n}"
      }
    ]
  }
}`
    }
  ];

  const mermaidDiagram = `
graph TB
    subgraph "MCP Workflow Automation Server"
        Client[MCP Client<br/>Cursor/Claude]
        Server["/api/mcp<br/>HTTP JSON-RPC"]
        
        Client -->|"initialize"| Server
        Client -->|"tools/list"| Server  
        Client -->|"tools/call"| Server
        
        Server --> Discovery[Workflow Discovery<br/>Supabase Database]
        Server --> ToolGen[Tool Generator<br/>Schema Analysis]
        Server --> Executor[Execution Handler<br/>Modal Integration]
        
        Discovery --> DB[(Supabase<br/>deployed_workflows)]
        Executor --> Modal[Modal VM<br/>Browser Automation]
        
        Modal --> BestPlan[Best Plan Pro<br/>Insurance App]
    end
    
    style Client fill:#e6f3ff,stroke:#000
    style Server fill:#000,stroke:#000,color:#fff
    style Discovery fill:#f9f9f9,stroke:#000
    style ToolGen fill:#f9f9f9,stroke:#000
    style Executor fill:#f9f9f9,stroke:#000
    style Modal fill:#fff5e6,stroke:#000
    style BestPlan fill:#e6ffe6,stroke:#000
    style DB fill:#f0f0f0,stroke:#000
`;

  // Generate navigation sections
  const navigationSections = [
    { id: 'overview', title: 'Overview', type: 'section' },
    { id: 'quickstart', title: 'Quick Start', type: 'section' },
    { id: 'protocol', title: 'MCP Protocol', type: 'section' },
    ...mcpEndpoints.map(endpoint => ({
      id: endpoint.id,
      title: endpoint.method,
      type: 'endpoint' as const
    })),
    { id: 'tools', title: 'Available Tools', type: 'section' },
    ...mcpTools.map(tool => ({
      id: `tool-${tool.name}`,
      title: tool.name.replace(/_/g, ' '),
      type: 'tool' as const
    }))
  ];

  const renderContent = () => {
    if (selectedSection === 'overview') {
      return (
        <div className="max-w-4xl">
          <h1 className="text-3xl font-bold mb-2">MCP Workflow Automation Server</h1>
          <span className="text-sm text-gray-500 mb-4 block">Model Context Protocol Integration</span>
          <p className="text-muted-foreground mb-8">
            Complete API reference for the MCP server that provides automation tools from your workflow database
          </p>
          
          {/* Loading State */}
          {loadingTools && (
            <div className="mb-4 p-3 bg-gray-50 border border-black rounded-lg">
              <div className="flex items-center gap-3">
                <div className="animate-spin">
                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full"></div>
                </div>
                <p className="text-gray-700 text-sm">Loading MCP tools from workflow database...</p>
              </div>
            </div>
          )}
          
          {toolsError && (
            <div className="mb-4 p-3 bg-gray-100 border border-black rounded-lg">
              <p className="text-gray-800 text-sm">[WARN] Could not load MCP tools: {toolsError}</p>
            </div>
          )}

          {/* Overview Content */}
          <div className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">What is MCP?</h2>
            <p className="text-gray-700 mb-4">
              The Model Context Protocol (MCP) enables AI assistants to securely access external tools and data sources.
              This server exposes your automation workflows as MCP tools, allowing AI assistants like Claude to execute
              complex automation tasks directly.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="p-4 border border-black rounded-lg">
                <h3 className="font-semibold mb-2">Available Tools</h3>
                <p className="text-sm text-gray-700">
                  {loadingTools ? 'Loading...' : `${mcpTools.length} automation tools`} discovered from your workflow database
                </p>
              </div>
              <div className="p-4 border border-black rounded-lg">
                <h3 className="font-semibold mb-2">Real-time Discovery</h3>
                <p className="text-sm text-gray-700">
                  Tools are automatically discovered from deployed workflows with 30-second caching
                </p>
              </div>
              <div className="p-4 border border-black rounded-lg">
                <h3 className="font-semibold mb-2">Protocol</h3>
                <p className="text-sm text-gray-700">
                  HTTP JSON-RPC transport on <code>/api/mcp</code>
                </p>
              </div>
              <div className="p-4 border border-black rounded-lg">
                <h3 className="font-semibold mb-2">Integration</h3>
                <p className="text-sm text-gray-700">
                  Built into Next.js app, deploys automatically to Vercel
                </p>
              </div>
            </div>
          </div>
          
          {/* Architecture Diagram */}
          <div className="mb-12 p-6 bg-gray-50 rounded-lg border border-black">
            <h2 className="text-xl font-semibold mb-4">Architecture Overview</h2>
            <pre className="mermaid">
{mermaidDiagram}
            </pre>
          </div>

          {/* Server Information */}
          <div className="mt-8 p-4 bg-gray-50 border border-black rounded-lg">
            <h3 className="text-lg font-semibold mb-3">Server Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p><strong>Server Name:</strong> Workflow Automation MCP Server</p>
                <p><strong>Version:</strong> 1.0.0</p>
                <p><strong>Protocol:</strong> MCP 2024-11-05</p>
              </div>
              <div>
                <p><strong>Transport:</strong> HTTP JSON-RPC</p>
                <p><strong>Endpoint:</strong> <code>/api/mcp</code></p>
                <p><strong>Health Check:</strong> <code>/api/mcp/health</code></p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (selectedSection === 'quickstart') {
      return (
        <div className="max-w-4xl">
          <h1 className="text-2xl font-bold mb-4">Quick Start Guide</h1>
          
          <div className="space-y-8">
            <div>
              <h2 className="text-xl font-semibold mb-3">1. Configure Cursor MCP</h2>
              <p className="text-gray-700 mb-3">
                Add the MCP server to your Cursor configuration at <code>~/.cursor/mcp.json</code>:
              </p>
              <CodeBlock language="json" title="~/.cursor/mcp.json">
{`{
  "mcpServers": {
    "workflow-automation": {
      "command": "node",
      "args": [],
      "transport": "http",
      "url": "${urls.mcpEndpoint}"
    }
  }
}`}
              </CodeBlock>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-3">2. Install SDK (Optional)</h2>
              <p className="text-gray-700 mb-3">
                For programmatic access, install the official MCP SDK for your preferred language:
              </p>
              
              <div className="space-y-4">
                <CodeBlock language="bash" title="JavaScript/TypeScript SDK">
{`npm install @modelcontextprotocol/sdk`}
                </CodeBlock>

                <CodeBlock language="bash" title="Python SDK">
{`pip install mcp httpx`}
                </CodeBlock>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-3">3. Test Connection</h2>
              <p className="text-gray-700 mb-3">
                Verify the server is running and accessible:
              </p>
              
              <Tabs defaultValue="curl" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="curl">curl</TabsTrigger>
                  <TabsTrigger value="javascript">JavaScript</TabsTrigger>
                  <TabsTrigger value="python">Python</TabsTrigger>
                </TabsList>
                
                <TabsContent value="curl">
                  <CodeBlock language="bash" title="Health Check">
{`curl ${urls.healthCheck}`}
                  </CodeBlock>
                </TabsContent>
                
                <TabsContent value="javascript">
                  <CodeBlock language="javascript" title="Health Check">
{`import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Connect to MCP server
const transport = new StreamableHTTPClientTransport('${urls.mcpEndpoint}');
const client = new Client(
  { name: "your-app", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

await client.connect(transport);
console.log('[SUCCESS] Connected to MCP server');`}
                  </CodeBlock>
                </TabsContent>
                
                <TabsContent value="python">
                  <CodeBlock language="python" title="Health Check">
{`import asyncio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async def test_connection():
    # Connect to MCP server
    async with streamablehttp_client('${urls.mcpEndpoint}') as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            # Test connection by listing tools
            tools = await session.list_tools()
            print(f'[SUCCESS] Connected to MCP server')
            print(f'[STATS] Tools available: {len(tools.tools)}')

# Run the test
asyncio.run(test_connection())`}
                  </CodeBlock>
                </TabsContent>
              </Tabs>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-3">4. List Available Tools</h2>
              <p className="text-gray-700 mb-3">
                Discover automation workflows available as MCP tools:
              </p>
              
              <Tabs defaultValue="curl" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="curl">curl</TabsTrigger>
                  <TabsTrigger value="javascript">JavaScript</TabsTrigger>
                  <TabsTrigger value="python">Python</TabsTrigger>
                </TabsList>
                
                <TabsContent value="curl">
                  <CodeBlock language="bash" title="Get Tools">
{`curl -X POST ${urls.mcpEndpoint} \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'`}
                  </CodeBlock>
                </TabsContent>
                
                <TabsContent value="javascript">
                  <CodeBlock language="javascript" title="Get Tools">
{`// List available tools
const result = await client.listTools();

result.tools.forEach((tool, index) => {
  console.log(\`\${index + 1}. \${tool.name}\`);
  console.log(\`   Description: \${tool.description}\`);
  console.log(\`   Parameters: \${Object.keys(tool.inputSchema?.properties || {}).length}\`);
});`}
                  </CodeBlock>
                </TabsContent>
                
                <TabsContent value="python">
                  <CodeBlock language="python" title="Get Tools">
{`# List available tools
tools = await session.list_tools()

for index, tool in enumerate(tools.tools, 1):
    print(f"{index}. {tool.name}")
    print(f"   Description: {tool.description}")
    properties = tool.inputSchema.get("properties", {}) if tool.inputSchema else {}
    print(f"   Parameters: {len(properties)}")`}
                  </CodeBlock>
                </TabsContent>
              </Tabs>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-3">5. Execute a Tool</h2>
              <p className="text-gray-700 mb-3">
                Execute automation workflows through the MCP interface:
              </p>
              
              <Tabs defaultValue="curl" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="curl">curl</TabsTrigger>
                  <TabsTrigger value="javascript">JavaScript</TabsTrigger>
                  <TabsTrigger value="python">Python</TabsTrigger>
                </TabsList>
                
                <TabsContent value="curl">
                  <CodeBlock language="bash" title="Execute Tool">
{`curl -X POST ${urls.mcpEndpoint} \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "insurance_set_available_products",
      "arguments": {
        "execution_mode": "async",
        "include_cache": true
      }
    }
  }'`}
                  </CodeBlock>
                </TabsContent>
                
                <TabsContent value="javascript">
                  <CodeBlock language="javascript" title="Execute Tool">
{`// Execute insurance product setup
const setupResult = await client.callTool({
  name: 'insurance_set_available_products',
  arguments: {
    execution_mode: 'async',
    include_cache: true
  }
});

// Execute insurance quote
const quoteResult = await client.callTool({
  name: 'insurance_best_plan_pro_insurance_quote',
  arguments: {
    execution_mode: 'async',
    applicant_dob: '01/15/1985',
    applicant_height: '5 10',
    applicant_weight: '180',
    applicant_gender: 'Male',
    applicant_state: 'California',
    applicant_zip_code: '90210',
    quote_type: 'Face Value',
    quote_value: '50000'
  }
});

console.log('🎯 Execution queued:', quoteResult);`}
                  </CodeBlock>
                </TabsContent>
                
                <TabsContent value="python">
                  <CodeBlock language="python" title="Execute Tool">
{`# Execute insurance product setup
setup_result = await session.call_tool(
    "insurance_set_available_products",
    {
        "execution_mode": "async",
        "include_cache": True
    }
)

# Execute insurance quote
quote_result = await session.call_tool(
    "insurance_best_plan_pro_insurance_quote",
    {
        "execution_mode": "async",
        "applicant_dob": "01/15/1985",
        "applicant_height": "5 10",
        "applicant_weight": "180",
        "applicant_gender": "Male",
        "applicant_state": "California",
        "applicant_zip_code": "90210",
        "quote_type": "Face Value",
        "quote_value": "50000"
    }
)

print("🎯 Execution queued:", quote_result.content[0].text)`}
                  </CodeBlock>
                </TabsContent>
              </Tabs>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 mb-2">💡 Complete Integration Example</h3>
              <p className="text-blue-800 text-sm mb-3">
                For a production-ready integration class with error handling, connection management, and result parsing, see our comprehensive example:
              </p>
              <CodeBlock language="javascript" title="WorkflowAutomationClient Class">
{`class WorkflowAutomationClient {
  constructor(mcpServerUrl = '${urls.mcpEndpoint}') {
    this.serverUrl = mcpServerUrl;
    this.client = null;
    this.transport = null;
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) return;
    
    this.transport = new StreamableHTTPClientTransport(this.serverUrl);
    this.client = new Client(
      { name: "workflow-automation-client", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );
    
    await this.client.connect(this.transport);
    this.isConnected = true;
  }

  async getAvailableWorkflows() {
    await this.connect();
    const result = await this.client.listTools();
    return result.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: Object.keys(tool.inputSchema?.properties || {})
    }));
  }

  async generateInsuranceQuote(applicantInfo) {
    await this.connect();
    
    const result = await this.client.callTool({
      name: 'insurance_best_plan_pro_insurance_quote',
      arguments: {
        execution_mode: 'async',
        include_cache: true,
        ...applicantInfo
      }
    });
    
    return this.parseExecutionResult(result);
  }

  parseExecutionResult(mcpResult) {
    if (mcpResult.content?.[0]?.text) {
      const data = JSON.parse(mcpResult.content[0].text);
      return {
        success: data.type === 'success',
        executionId: data.execution_id,
        workflowName: data.data?.workflow_name,
        status: data.status,
        message: data.message,
        endpoints: data.data?.endpoints
      };
    }
    return { success: false, message: 'Failed to parse result' };
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.close();
      this.isConnected = false;
    }
  }
}

// Usage
const automation = new WorkflowAutomationClient();
const quote = await automation.generateInsuranceQuote({
  applicant_dob: '01/15/1985',
  applicant_state: 'California',
  applicant_gender: 'Male',
  quote_type: 'Face Value',
  quote_value: '50000'
});
console.log('Quote Result:', quote);`}
              </CodeBlock>
            </div>
          </div>
        </div>
      );
    }

    if (selectedSection === 'protocol') {
      return (
        <div className="max-w-4xl">
          <h1 className="text-2xl font-bold mb-4">MCP Protocol Reference</h1>
          
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-3">Transport</h2>
              <p className="text-gray-700 mb-3">
                This server uses HTTP transport with JSON-RPC 2.0 protocol. All requests are sent via POST to the <code>/api/mcp</code> endpoint.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-3">Request Format</h2>
              <CodeBlock language="json" title="JSON-RPC Request">
{`{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "method_name",
  "params": {
    // method-specific parameters
  }
}`}
              </CodeBlock>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-3">Response Format</h2>
              <CodeBlock language="json" title="JSON-RPC Success Response">
{`{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    // method-specific result
  }
}`}
              </CodeBlock>
              
              <CodeBlock language="json" title="JSON-RPC Error Response">
{`{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params"
  }
}`}
              </CodeBlock>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-3">Error Codes</h2>
              <div className="overflow-x-auto">
                <table className="w-full border border-black text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-black px-3 py-2 text-left">Code</th>
                      <th className="border border-black px-3 py-2 text-left">Message</th>
                      <th className="border border-black px-3 py-2 text-left">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-black px-3 py-2"><code>-32601</code></td>
                      <td className="border border-black px-3 py-2">Method not found</td>
                      <td className="border border-black px-3 py-2">The requested method is not supported</td>
                    </tr>
                    <tr>
                      <td className="border border-black px-3 py-2"><code>-32602</code></td>
                      <td className="border border-black px-3 py-2">Invalid params</td>
                      <td className="border border-black px-3 py-2">The provided parameters are invalid</td>
                    </tr>
                    <tr>
                      <td className="border border-black px-3 py-2"><code>-32603</code></td>
                      <td className="border border-black px-3 py-2">Internal error</td>
                      <td className="border border-black px-3 py-2">Server-side error occurred</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (selectedSection === 'tools') {
      return (
        <div className="max-w-4xl">
          <h1 className="text-2xl font-bold mb-4">Available Tools</h1>
          
          {loadingTools ? (
            <div className="flex items-center gap-3 p-4 bg-gray-50 border border-black rounded-lg">
              <div className="animate-spin">
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full"></div>
              </div>
              <span className="text-gray-700">Loading automation tools...</span>
            </div>
          ) : toolsError ? (
            <div className="p-4 bg-gray-100 border border-black rounded-lg">
              <p className="text-gray-800">[WARN] Error loading tools: {toolsError}</p>
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-gray-700">
                The following tools are automatically discovered from your deployed workflows:
              </p>
              
              {mcpTools.length === 0 ? (
                <div className="p-4 bg-gray-50 border border-black rounded-lg text-center">
                  <p className="text-gray-600">No tools available. Make sure you have deployed workflows in your database.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {mcpTools.map((tool, index) => (
                    <div key={index} className="p-4 border border-black rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="text-lg font-semibold">{tool.name}</h3>
                        {tool.metadata?.estimated_duration_seconds && (
                          <Badge variant="outline" className="border-black">
                            ~{tool.metadata.estimated_duration_seconds}s
                          </Badge>
                        )}
                      </div>
                      <p className="text-gray-700 mb-3">{tool.description}</p>
                      
                      <div className="space-y-2">
                        <h4 className="font-medium">Parameters:</h4>
                        <div className="grid gap-2">
                          {Object.entries(tool.inputSchema.properties).map(([paramName, paramSchema]) => (
                            <div key={paramName} className="flex items-center gap-2 text-sm">
                              <code className="bg-gray-100 px-2 py-1 rounded border border-gray-300">
                                {paramName}
                              </code>
                              <span className="text-gray-600">
                                ({paramSchema.type}{tool.inputSchema.required?.includes(paramName) ? ', required' : ', optional'})
                              </span>
                              {paramSchema.description && (
                                <span className="text-gray-700">- {paramSchema.description}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // Handle MCP Protocol endpoints
    const endpoint = mcpEndpoints.find(ep => ep.id === selectedSection);
    if (endpoint) {
      return (
        <div className="max-w-4xl">
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <Badge className="bg-black text-white border border-black">
                {endpoint.method}
              </Badge>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{endpoint.method}</h1>
            <p className="text-gray-700 mt-2">{endpoint.description}</p>
          </div>

          <div className="space-y-6">
            <div>
              <CodeBlock language="json" title="Request">
                {endpoint.requestExample}
              </CodeBlock>
            </div>
            
            <div>
              <CodeBlock language="json" title="Response">
                {endpoint.responseExample}
              </CodeBlock>
            </div>
          </div>
        </div>
      );
    }

    // Handle specific tool documentation
    if (selectedSection.startsWith('tool-')) {
      const toolName = selectedSection.replace('tool-', '');
      const tool = mcpTools.find(t => t.name === toolName);
      
      if (!tool) {
        return (
          <div className="max-w-4xl">
            <h1 className="text-2xl font-bold mb-4">Tool Not Found</h1>
            <p>The requested tool &quot;{toolName}&quot; was not found.</p>
          </div>
        );
      }



      return (
        <div className="max-w-4xl">
          <div className="mb-6">
            <h1 className="text-2xl font-bold mb-2">{tool.name}</h1>
            <p className="text-gray-700">{tool.description}</p>
            {tool.metadata?.estimated_duration_seconds && (
              <div className="mt-2">
                <Badge variant="outline" className="border-black">
                  Estimated duration: {tool.metadata.estimated_duration_seconds} seconds
                </Badge>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {/* Parameters Table */}
            <div>
              <h2 className="text-xl font-semibold mb-3">Parameters</h2>
              <div className="overflow-x-auto">
                <table className="w-full border border-black text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-black px-3 py-2 text-left">Parameter</th>
                      <th className="border border-black px-3 py-2 text-left">Type</th>
                      <th className="border border-black px-3 py-2 text-center">Required</th>
                      <th className="border border-black px-3 py-2 text-left">Default</th>
                      <th className="border border-black px-3 py-2 text-left">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(tool.inputSchema.properties).map(([paramName, paramSchema]) => (
                      <tr key={paramName}>
                        <td className="border border-black px-3 py-2">
                          <code className="bg-gray-100 px-2 py-1 rounded">{paramName}</code>
                        </td>
                        <td className="border border-black px-3 py-2">
                          <Badge variant="outline" className="border-black text-xs">
                            {paramSchema.type}
                          </Badge>
                          {paramSchema.enum && (
                            <div className="text-xs text-gray-600 mt-1">
                              Options: {paramSchema.enum.join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="border border-black px-3 py-2 text-center">
                          {tool.inputSchema.required?.includes(paramName) ? (
                            <span className="text-black font-medium">Yes</span>
                          ) : (
                            <span className="text-gray-600">No</span>
                          )}
                        </td>
                        <td className="border border-black px-3 py-2">
                          {paramSchema.default !== undefined ? (
                            <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
                              {JSON.stringify(paramSchema.default)}
                            </code>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="border border-black px-3 py-2 text-sm">
                          {paramSchema.description || 'No description available'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Usage Example */}
            <div>
              <h2 className="text-xl font-semibold mb-3">Usage Example</h2>
              <CodeBlock language="json" title="MCP Tool Call">
                {`{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "${tool.name}",
    "arguments": {${Object.entries(tool.inputSchema.properties)
      .filter(([, schema]) => schema.default !== undefined)
      .map(([name, schema]) => `\n      "${name}": ${JSON.stringify(schema.default)}`)
      .join(',')
    }${Object.keys(tool.inputSchema.properties).some(key => tool.inputSchema.properties[key].default !== undefined) ? '\n    ' : ''}
    }
  }
}`}
              </CodeBlock>
            </div>

            {/* Copy Tool Call Button */}
            <div className="p-4 bg-gray-50 border border-black rounded-lg">
              <h3 className="font-medium mb-2">Quick Test</h3>
              <p className="text-sm text-gray-700 mb-3">
                Copy this curl command to test the tool directly:
              </p>
              <button
                onClick={() => copyToClipboard(
                  `curl -X POST ${urls.mcpEndpoint} \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "${tool.name}",
      "arguments": {${Object.entries(tool.inputSchema.properties)
        .filter(([, schema]) => schema.default !== undefined)
        .map(([name, schema]) => `\n        "${name}": ${JSON.stringify(schema.default)}`)
        .join(',')
      }${Object.keys(tool.inputSchema.properties).some(key => tool.inputSchema.properties[key].default !== undefined) ? '\n      ' : ''}
      }
    }
  }'`,
                  `curl-${tool.name}`
                )}
                className="px-4 py-2 bg-black text-white border border-black rounded hover:bg-gray-800 transition-colors text-sm font-medium"
              >
                {copiedStates[`curl-${tool.name}`] || 'Copy Test Command'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Mobile Header */}
      <div className="lg:hidden border-b border-black bg-white p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">MCP API Documentation</h1>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 border border-black rounded"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div className={`
          fixed lg:static inset-y-0 left-0 z-50 w-72 bg-white border-r border-black overflow-y-auto
          transform transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <div className="p-6">
            <div className="hidden lg:block mb-8">
              <h2 className="text-xl font-bold">MCP API Documentation</h2>
              <p className="text-sm text-gray-600 mt-1">Workflow Automation Server</p>
            </div>
            
            <nav className="space-y-1">
              {navigationSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => {
                    setSelectedSection(section.id);
                    setSidebarOpen(false);
                  }}
                  className={`
                    w-full text-left px-3 py-2 rounded border transition-colors text-sm
                    ${selectedSection === section.id 
                      ? 'bg-black text-white border-black' 
                      : 'border-transparent hover:bg-gray-50 hover:border-gray-200'
                    }
                    ${section.type === 'endpoint' ? 'ml-4 font-mono' : ''}
                    ${section.type === 'tool' ? 'ml-4 text-xs' : ''}
                  `}
                >
                  {section.type === 'endpoint' && (
                    <span className="text-xs opacity-75 mr-2">RPC</span>
                  )}
                  {section.type === 'tool' && (
                    <span className="text-xs opacity-75 mr-2"></span>
                  )}
                  {section.title}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-6 lg:p-8">
          {renderContent()}
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
} 