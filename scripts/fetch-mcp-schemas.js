/**
 * Fetch real MCP tool schemas from running Terminator instance
 * Use these for integration tests
 */

const fs = require('fs');
const path = require('path');

async function fetchMcpSchemas() {
  try {
    // Call MCP server (simulated - in real test we'd use actual HTTP)
    const mcpUrl = 'http://127.0.0.1:8080/tools';
    
    const response = await fetch(mcpUrl);
    if (!response.ok) {
      throw new Error(`MCP server returned ${response.status}`);
    }
    
    const data = await response.json();
    
    // Extract first 5 tools with complex schemas
    const toolSchemas = Object.entries(data.tools || {})
      .slice(0, 10)
      .map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }));
    
    // Save to test fixtures
    const fixturesDir = path.join(__dirname, '../__tests__/fixtures');
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
    
    fs.writeFileSync(
      path.join(fixturesDir, 'mcp-tool-schemas.json'),
      JSON.stringify(toolSchemas, null, 2)
    );
    
    console.log(`✅ Saved ${toolSchemas.length} MCP tool schemas to __tests__/fixtures/mcp-tool-schemas.json`);
    
    // Print summary
    toolSchemas.forEach(tool => {
      const hasProblematicFields = JSON.stringify(tool.inputSchema).includes('$schema') ||
                                   JSON.stringify(tool.inputSchema).includes('$ref') ||
                                   JSON.stringify(tool.inputSchema).includes('anyOf') ||
                                   JSON.stringify(tool.inputSchema).includes('const');
      console.log(`  - ${tool.name}: ${hasProblematicFields ? '⚠️  Has problematic fields' : '✓'}`);
    });
    
  } catch (error) {
    console.error('❌ Failed to fetch MCP schemas:', error.message);
    process.exit(1);
  }
}

fetchMcpSchemas();
