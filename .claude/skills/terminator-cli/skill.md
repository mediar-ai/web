---
name: terminator-cli
description: Run Terminator MCP CLI for testing workflows locally. Auto-activates when user says "test workflow", "terminator", "mcp exec", "mcp run", "mcp chat", or wants to validate/execute workflows against MCP server.
allowed-tools: Bash
---

# Terminator MCP CLI

Test and execute workflows against MCP servers.

---

## Interactive Chat
```bash
terminator mcp chat --url http://localhost:3000
terminator mcp chat --command "npx -y terminator-mcp-agent"
```

## Execute Single Tool
```bash
terminator mcp exec --url http://localhost:3000 click_element '{"selector": "role:Button && name:Submit"}'
terminator mcp exec --url http://localhost:3000 get_window_tree '{"process": "chrome"}'
terminator mcp exec --url http://localhost:3000 type_into_element '{"selector": "role:Edit", "text_to_type": "hello"}'
terminator mcp exec --url http://localhost:3000 press_key '{"key": "{Enter}"}'
terminator mcp exec --url http://localhost:3000 navigate_browser '{"url": "https://example.com", "process": "chrome"}'
```

## Run Workflow File
```bash
terminator mcp run workflow.yml --url http://localhost:3000
terminator mcp run workflow.yml --dry-run              # validate only
terminator mcp run workflow.yml --verbose              # detailed output
terminator mcp run workflow.yml --no-stop-on-error     # continue on errors
terminator mcp run workflow.yml --start-from-step "step_3"
terminator mcp run workflow.yml --end-at-step "step_5"
```

## Validate Output
```bash
terminator mcp validate output.json
terminator mcp validate output.json --score
```

## Debug Mode
```bash
LOG_LEVEL=debug terminator mcp chat --url http://localhost:3000
```
