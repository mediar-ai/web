# Test Suite Documentation

This directory contains comprehensive tests for the Browser Workflow Capture App's AI API and MCP integration.

## 📋 Test Categories

### 🔧 Unit Tests
Focused tests for individual components and functions:

- **`schema-conversion.test.ts`** - Tests MCP JSON Schema v7 to Vertex AI conversion
- **`authentication.test.ts`** - Tests API authentication middleware
- **`message-format.test.ts`** - Tests message validation and format conversion

### 🌐 Integration Tests
End-to-end tests for complete workflows:

- **`ai-mcp-integration.test.ts`** - Complete AI API + MCP tools integration
- **`frontend-integration.test.ts`** - Frontend-specific integration testing
- **`frontend-backend-integration.test.ts`** - Full-stack integration tests

### 🛠️ Test Utilities
- **`utils.ts`** - Shared test utilities, mock functions, and TestLogger
- **`types.ts`** - TypeScript interfaces for test data structures
- **`fixtures/mcp-tools.ts`** - Mock MCP tool definitions for testing

## 🚀 Quick Start

### Run All Tests
```bash
# Run the complete test suite
npm run test:all

# Run only unit tests
npm run test:unit

# Run only integration tests  
npm run test:integration
```

### Run Specific Test Categories
```bash
# Schema conversion tests only
npm run test:unit -- --schema

# Authentication tests only
npm run test:unit -- --auth

# Message format tests only
npm run test:unit -- --messages

# With verbose logging
npm run test:unit -- --verbose

# With performance benchmarks
npm run test:unit -- --benchmark
```

### Individual Test Files
```bash
# Run individual test files
npx ts-node src/tests/schema-conversion.test.ts
npx ts-node src/tests/authentication.test.ts
npx ts-node src/tests/ai-mcp-integration.test.ts
```

## 📊 Test Coverage

### Unit Tests (40+ tests)
- ✅ **Schema Conversion** (10 tests)
  - Basic schema cleaning
  - Complex schema with unsupported fields
  - Nested schemas and arrays
  - Enum validation
  - Real-world MCP tool schemas
  - Edge cases and error handling

- ✅ **Authentication** (10 tests) 
  - Bearer token validation
  - Basic auth validation
  - Malformed headers
  - Unsupported auth schemes
  - Case sensitivity
  - Security edge cases

- ✅ **Message Format** (12 tests)
  - Standard OpenAI format
  - Parts-based messages
  - Vertex AI conversion
  - Function calls/responses
  - Mixed formats
  - Validation and edge cases

### Integration Tests (25+ tests)
- ✅ **AI-MCP Integration** (15 tests)
  - Health checks
  - Basic tool calling
  - Complex tool interactions
  - Multi-step workflows
  - Streaming responses
  - Error handling
  - Frontend UX patterns

- ✅ **Frontend Integration** (8 tests)
  - Message format compatibility
  - Streaming response parsing
  - Tool execution cycles
  - Error scenarios

- ✅ **Full-Stack Integration** (8 tests)
  - Complete request/response cycles
  - Real-world chat scenarios
  - Tool results continuation
  - Concurrent tool calls

## 🧪 Test Architecture

### Test Structure
```
src/tests/
├── unit-tests.test.ts          # Master unit test runner
├── schema-conversion.test.ts   # Schema conversion unit tests
├── authentication.test.ts      # Auth middleware unit tests
├── message-format.test.ts      # Message format unit tests
├── ai-mcp-integration.test.ts  # Complete AI+MCP integration
├── frontend-integration.test.ts # Frontend-specific tests
├── frontend-backend-integration.test.ts # Full-stack tests
├── utils.ts                    # Test utilities and mocks
├── types.ts                    # Test type definitions
└── fixtures/
    └── mcp-tools.ts           # Mock tool definitions
```

### Key Testing Patterns

#### 1. **Schema Validation Testing**
```typescript
// Test unsupported JSON Schema v7 fields are removed
const inputSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'TestSchema',
  definitions: { SomeType: { type: 'string' } },
  // ... more fields
};

const result = cleanSchemaForVertexAI(inputSchema);
// Should remove $schema, title, definitions, etc.
```

#### 2. **Authentication Testing**
```typescript
// Test various auth header formats
const testCases = [
  'Bearer valid-password',
  'Basic ' + Buffer.from('user:password').toString('base64'),
  'Invalid scheme',
  // ... more cases
];
```

#### 3. **Streaming Response Testing**
```typescript
// Parse SSE stream and validate events
const chunks = parseStreamingResponse(response.body);
const hasToolCall = chunks.some(c => c.type === 'toolCall');
const hasFinish = chunks.some(c => c.type === 'finish');
```

## 🎯 Test Goals

### 🔒 **Backend Reliability**
- Ensure robust schema conversion for 40+ MCP tools
- Validate authentication across multiple formats
- Test message handling for various input formats
- Verify error handling and edge cases

### 🌐 **Frontend Compatibility**
- Validate streaming response format matches frontend expectations
- Test tool execution cycle matches frontend implementation
- Ensure message formats are properly handled
- Verify error scenarios are handled gracefully

### 🚀 **End-to-End Workflows**
- Test complete AI + MCP tool workflows
- Validate multi-step tool sequences
- Test real-world user scenarios
- Ensure performance and reliability

## 📈 Test Metrics

### Coverage Goals
- **Unit Tests**: 95%+ coverage of core functions
- **Integration Tests**: 100% coverage of API endpoints
- **E2E Tests**: 90%+ coverage of user workflows

### Performance Benchmarks
- Schema conversion: < 10ms per tool
- Authentication: < 1ms per request
- Message validation: < 5ms per message
- Full tool workflow: < 5s end-to-end

## 🔧 Development Workflow

### Adding New Tests
1. **Unit Tests**: Add to appropriate test file or create new one
2. **Integration Tests**: Add to `ai-mcp-integration.test.ts`
3. **Update Master Runner**: Add to `unit-tests.test.ts` if new suite

### Test-Driven Development
1. Write failing test first
2. Implement minimum code to pass
3. Refactor and optimize
4. Ensure all tests still pass

### Debugging Tests
```bash
# Run with verbose logging
npm run test:unit -- --verbose

# Run specific test
npm run test:unit -- --schema

# Run with Node.js debugger
node --inspect-brk node_modules/.bin/ts-node src/tests/schema-conversion.test.ts
```

## 🏆 Quality Assurance

### Test Standards
- ✅ Every function has unit tests
- ✅ Every API endpoint has integration tests
- ✅ Every user workflow has E2E tests
- ✅ All edge cases and error conditions tested
- ✅ Performance benchmarks for critical paths

### Continuous Integration
- All tests must pass before merge
- Performance regressions flagged automatically
- Coverage reports generated and tracked
- Test results integrated with deployment pipeline

## 📚 Additional Resources

- [MCP Documentation](https://modelcontextprotocol.io/)
- [Vertex AI API Reference](https://cloud.google.com/vertex-ai/docs)
- [TypeScript Testing Best Practices](https://github.com/microsoft/TypeScript/wiki/Coding-guidelines)

---

**Note**: This test suite is designed to ensure the reliability and robustness of the AI API and MCP integration. Run tests regularly during development and before deployment. 