# Testing Guide

## Overview

We use **Vitest** for frontend testing with React Testing Library, and **Cargo** for Rust backend testing.

## Test Structure

```
src/
├── hooks/
│   ├── __tests__/           # Hook tests
│   │   ├── useChat.test.ts
│   │   └── useMcp.test.ts
│   └── useChat.ts
├── lib/
│   ├── __tests__/           # Utility/library tests
│   │   ├── mcp-client.test.ts
│   │   └── utils.test.ts
│   └── mcp-client.ts
├── components/
│   ├── __tests__/           # Component tests
│   │   ├── Chat.test.tsx
│   │   └── Workflow.test.tsx
│   └── Chat.tsx
└── test/
    ├── setup.ts             # Global test setup
    ├── mocks/               # Shared mocks
    │   ├── tauri.ts
    │   └── mcp.ts
    └── helpers/             # Test helpers
        └── render.tsx

src-tauri/src/
├── mcp_server.rs
├── workflow_mcp_server.rs
└── tests/                   # Rust integration tests
    └── mcp_integration.rs
```

## Running Tests

### Frontend Tests

```bash
# Run all tests
bun run test

# Watch mode
bun run test:watch

# With UI
bun run test:ui

# With coverage
bun run test:coverage

# CI mode (verbose output, JUnit, JSON reports)
bun run test:ci
```

### Backend Tests

```bash
# Run Rust tests
cd src-tauri && cargo test

# With output
cd src-tauri && cargo test -- --nocapture

# Specific test
cd src-tauri && cargo test test_mcp_server

# Run clippy (linter)
cd src-tauri && cargo clippy -- -D warnings

# Check formatting
cd src-tauri && cargo fmt --check
```

## Test Types

### 1. Unit Tests

Test individual functions/utilities in isolation.

**Example: Testing a utility function**
```typescript
// src/lib/__tests__/utils.test.ts
import { describe, it, expect } from 'vitest';
import { formatTimestamp, parseWorkflowYaml } from '../utils';

describe('formatTimestamp', () => {
  it('formats timestamp correctly', () => {
    const date = new Date('2024-01-01T12:00:00Z');
    expect(formatTimestamp(date)).toBe('12:00 PM');
  });

  it('handles invalid dates', () => {
    expect(formatTimestamp(null)).toBe('Invalid Date');
  });
});
```

### 2. Hook Tests

Test React hooks with `@testing-library/react-hooks`.

**Example: Testing useMcp hook**
```typescript
// src/hooks/__tests__/useMcp.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMcpTools } from '../useMcp';

// Mock the MCP client
vi.mock('../../lib/mcp-client', () => ({
  mcpClient: {
    connect: vi.fn(),
    getTools: vi.fn(),
    callTool: vi.fn(),
  },
}));

describe('useMcpTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discovers tools on mount', async () => {
    const { result } = renderHook(() => useMcpTools());

    await waitFor(() => {
      expect(result.current.isHealthy).toBe(true);
      expect(Object.keys(result.current.tools).length).toBeGreaterThan(0);
    });
  });

  it('handles server unavailable', async () => {
    vi.mocked(mcpClient.connect).mockRejectedValueOnce(new Error('Connection failed'));

    const { result } = renderHook(() => useMcpTools());

    await waitFor(() => {
      expect(result.current.error).toContain('Connection failed');
    });
  });
});
```

### 3. Component Tests

Test React components with user interactions.

**Example: Testing Chat component**
```typescript
// src/components/__tests__/Chat.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Chat } from '../Chat';

describe('Chat Component', () => {
  it('renders chat input', () => {
    render(<Chat />);
    expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument();
  });

  it('sends message on submit', async () => {
    const onSend = vi.fn();
    render(<Chat onSend={onSend} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    const sendButton = screen.getByRole('button', { name: /send/i });

    fireEvent.change(input, { target: { value: 'Hello AI' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('Hello AI');
    });
  });

  it('displays loading state during tool execution', async () => {
    render(<Chat />);

    // Trigger tool execution
    fireEvent.click(screen.getByRole('button', { name: /run workflow/i }));

    expect(screen.getByText(/executing/i)).toBeInTheDocument();
  });
});
```

### 4. Integration Tests

Test multiple components/systems working together.

**Example: MCP integration test**
```typescript
// src/hooks/__tests__/useChat.integration.test.ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useChat } from '../useChat';
import { useMcpTools } from '../useMcp';

describe('Chat + MCP Integration', () => {
  it('executes MCP tools from chat messages', async () => {
    // Setup hooks
    const { result: mcpResult } = renderHook(() => useMcpTools());
    const { result: chatResult } = renderHook(() => useChat());

    // Wait for MCP to be ready
    await waitFor(() => expect(mcpResult.current.isHealthy).toBe(true));

    // Send message that triggers tool
    await act(async () => {
      await chatResult.current.sendMessage('Click the submit button');
    });

    // Verify tool was called
    await waitFor(() => {
      const lastMessage = chatResult.current.messages[chatResult.current.messages.length - 1];
      expect(lastMessage.role).toBe('assistant');
      expect(lastMessage.toolCalls).toBeDefined();
    });
  });
});
```

### 5. Rust Tests

**Example: Unit test**
```rust
// src-tauri/src/mcp_server.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_server_info_creation() {
        let info = McpServerInfo {
            port: 8080,
            is_running: true,
            url: "http://127.0.0.1:8080".to_string(),
            uptime_seconds: 0,
        };

        assert_eq!(info.port, 8080);
        assert!(info.is_running);
    }

    #[tokio::test]
    async fn test_find_available_port() {
        let port = McpServerManager::find_available_port().await;
        assert!(port.is_ok());
        let port_num = port.unwrap();
        assert!(port_num >= 8080 && port_num < 8200);
    }
}
```

**Example: Integration test**
```rust
// src-tauri/tests/mcp_integration.rs
use mediar_app::mcp_server::*;

#[tokio::test]
async fn test_mcp_server_lifecycle() {
    // Note: This requires mocking the app_handle
    // Real integration tests should use the mediar-mcp-testing framework
}
```

## Mocking

### Mocking Tauri APIs

```typescript
// src/test/mocks/tauri.ts
import { vi } from 'vitest';

export const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: mockInvoke,
}));
```

### Mocking MCP Client

```typescript
// src/test/mocks/mcp.ts
import { vi } from 'vitest';

export const mockMcpClient = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  getTools: vi.fn().mockResolvedValue({
    click_element: {
      name: 'click_element',
      description: 'Click an element',
      inputSchema: {},
    },
  }),
  callTool: vi.fn(),
};

vi.mock('../../lib/mcp-client', () => ({
  mcpClient: mockMcpClient,
}));
```

## Best Practices

### 1. Arrange-Act-Assert (AAA) Pattern

```typescript
it('updates user profile', async () => {
  // Arrange
  const user = { id: 1, name: 'Old Name' };
  const newName = 'New Name';

  // Act
  const result = await updateProfile(user.id, newName);

  // Assert
  expect(result.name).toBe(newName);
});
```

### 2. Test Naming

Use descriptive names that explain what's being tested:
```typescript
// ❌ Bad
it('works', () => {});

// ✅ Good
it('displays error message when server is unavailable', () => {});
```

### 3. Keep Tests Focused

Each test should verify one behavior:
```typescript
// ❌ Bad - testing multiple things
it('chat works', () => {
  // Tests sending, receiving, errors, etc.
});

// ✅ Good - focused tests
it('sends message when user presses enter', () => {});
it('displays error when message fails to send', () => {});
it('clears input after successful send', () => {});
```

### 4. Use Test Factories

Create helper functions to generate test data:
```typescript
// src/test/helpers/factories.ts
export const createMockTool = (overrides = {}) => ({
  name: 'click_element',
  description: 'Click an element',
  inputSchema: {},
  ...overrides,
});

export const createMockMessage = (overrides = {}) => ({
  id: crypto.randomUUID(),
  role: 'user',
  content: 'Hello',
  timestamp: new Date(),
  ...overrides,
});
```

### 5. Clean Up After Tests

```typescript
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Clean up any side effects
});
```

## Coverage Goals

- **Critical paths**: >80% coverage (MCP client, chat logic, workflow execution)
- **UI components**: >60% coverage
- **Utilities**: >80% coverage
- **Overall**: >60% coverage

Run `bun run test:coverage` to see coverage report.

## Debugging Tests

### VS Code Debugger

Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Vitest Tests",
  "runtimeExecutable": "bun",
  "runtimeArgs": ["test", "--run", "--inspect-brk", "--pool=threads", "--poolOptions.threads.singleThread"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

### Console Logging

```typescript
import { debug } from '@testing-library/react';

it('renders component', () => {
  const { container } = render(<MyComponent />);
  debug(container); // Prints DOM to console
});
```

## Continuous Integration

Tests run automatically on:
- Every push to main
- Every pull request
- Before builds

See `.github/workflows/ci.yml` for configuration.

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Rust Testing Guide](https://doc.rust-lang.org/book/ch11-00-testing.html)
