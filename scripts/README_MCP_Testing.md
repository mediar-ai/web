# MCP SDK Testing

This directory contains comprehensive test scripts for validating our MCP (Model Context Protocol) server using the official MCP JavaScript SDK.

## Overview

The MCP test script (`test_mcp_sdk.js`) provides automated testing for:
- ✅ Connection and initialization
- 🔍 Tool discovery from workflow database
- 🚀 Tool execution with various scenarios
- ⚠️ Error handling and validation
- ⚡ Performance and concurrency testing

## Setup

### 1. Install Dependencies

```bash
cd scripts
npm install
```

### 2. Environment Variables (Optional)

```bash
# Override default MCP server URL
export MCP_SERVER_URL="https://your-custom-domain.com/api/mcp"
```

## Usage

### Run All Tests Against Production

```bash
# Test production MCP server at https://app.mediar.ai/api/mcp
npm run test:mcp

# Or directly
node test_mcp_sdk.js
```

### Run All Tests Against Local Development

```bash
# Test local MCP server at http://localhost:3000/api/mcp
npm run test:mcp:local

# Or directly
node test_mcp_sdk.js --local
```

### Run Specific Test Categories

```bash
# Production server with custom environment
MCP_SERVER_URL="https://staging.example.com/api/mcp" node test_mcp_sdk.js

# Test specific quote parameters
npm run quote:test                    # Test with specific parameters (production)
npm run quote:test:local             # Test with specific parameters (local)
```

## Test Scenarios

### 🔌 Connection Testing
- HTTP transport initialization
- MCP client connection
- Server capability negotiation

### 🔍 Tool Discovery Testing
- Lists all available tools from workflow database
- Validates tool metadata and schemas
- Checks tool parameter definitions

### 🚀 Tool Execution Testing

#### Set Available Products Tool
- **Default Parameters**: Basic async execution with cache
- **Sync Mode**: Synchronous execution with detailed response

#### Best Plan Pro Insurance Quote Tool
- **Basic Quote**: Male applicant, California, Face Value $50,000
- **Female Applicant**: Texas applicant, Max Monthly Budget $200
- **Parameter Variations**: Different states, ages, tobacco usage
- **Specific Parameter Test**: Custom quote with exact user-provided parameters

### ⚠️ Error Handling Testing
- **Invalid Tool Names**: Tests non-existent tools
- **Missing Parameters**: Validates required parameter enforcement
- **Invalid Values**: Tests parameter type validation

### ⚡ Performance Testing
- **Sequential Requests**: Measures baseline performance
- **Concurrent Requests**: Tests server under parallel load
- **Performance Comparison**: Calculates concurrency benefits

## Sample Output

```
🧪 Starting MCP SDK Test Suite
=====================================
🔌 Connecting to MCP server: https://app.mediar.ai/api/mcp
✅ Successfully connected to MCP server

📋 Testing Server Initialization...
✅ Server initialization successful

🔍 Testing Tool Discovery...
✅ Discovered 2 tools:
  1. insurance_set_available_products
     Description: Configuration workflow to enable all available insurance products...
     Parameters: 5 properties
  2. insurance_best_plan_pro_insurance_quote
     Description: Complete insurance quoting workflow for Best Plan Pro system...
     Parameters: 16 properties

🚀 Testing Tool Execution...

  📝 Testing: Set Available Products - Default Parameters
  ✅ Success (1842ms)
  📄 Result: {
    "content": [{
      "type": "text",
      "text": "✅ Execution 5402 created successfully..."
    }]
  }

⚠️ Testing Error Handling...
  🧪 Testing: Invalid Tool Name
  ✅ Correctly handled error: Tool not found: nonexistent_tool

⚡ Testing Performance...
  📊 Testing sequential tool discovery...
  ⏱️ Sequential (3 requests): 847ms
  📊 Testing concurrent tool discovery...
  ⏱️ Concurrent (3 requests): 312ms

📊 Test Summary
================
🔌 Connection: ✅ PASS
📋 Initialization: ✅ PASS
🔍 Tool Discovery: ✅ PASS (2 tools found)
🚀 Tool Execution: 4/4 scenarios passed
⚠️ Error Handling: 3/3 scenarios handled correctly
⚡ Performance: 63.2% improvement with concurrency

🎯 Overall Status: ✅ HEALTHY
```

## Troubleshooting

### Connection Issues
```bash
# Test local server first
npm run test:mcp:local

# Check if dev server is running
npm run dev

# Verify MCP endpoint manually
curl https://app.mediar.ai/api/mcp/health
```

### Tool Execution Failures
- Check Modal VM service status
- Verify workflow is deployed and active
- Review execution logs in deployment dashboard

### SDK Issues
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Check SDK version compatibility
npm list @modelcontextprotocol/sdk
```

## Extending Tests

### Adding New Test Scenarios

```javascript
// In testToolExecution method, add to testScenarios array:
{
  name: 'Your Custom Test',
  toolName: 'your_tool_name',
  arguments: {
    // Your test parameters
  }
}
```

### Custom Error Scenarios

```javascript
// In testErrorHandling method, add to errorScenarios array:
{
  name: 'Your Error Test',
  toolName: 'some_tool',
  arguments: {
    // Invalid parameters to test
  }
}
```

## Integration with CI/CD

```yaml
# GitHub Actions example
- name: Test MCP Server
  run: |
    cd scripts
    npm install
    npm run test:mcp
  env:
    MCP_SERVER_URL: ${{ secrets.MCP_SERVER_URL }}
```

## Files

- `test_mcp_sdk.js` - Main test script with comprehensive MCP testing
- `test_mcp_quick.js` - Quick health check for fast validation
- `test_specific_quote.js` - Test quote tool with specific parameters
- `mcp_integration_example.js` - Complete integration example with WorkflowAutomationClient
- `package.json` - Dependencies and npm scripts
- `README_MCP_Testing.md` - This documentation file

## Related Documentation

- [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)
- [MCP JavaScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Main App MCP Documentation](../src/app/docs/api/mcp/page.tsx) 