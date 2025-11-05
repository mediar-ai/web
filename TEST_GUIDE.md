# Testing Claude Server-Side Tools

## What Changed

We added server-side tool support for Anthropic/Claude models to match the existing Gemini/Vertex functionality. Claude can now:

1. **Access server-side tools** without client round-trip:
   - `search_similar_workflow_steps` - Semantic search of workflow knowledge base
   - `search_terminator_docs` - Search Terminator automation documentation

2. **Auto-execute server tools** - When Claude calls a server tool, it executes immediately on the backend and Claude automatically continues the conversation with the results

3. **Feature parity with Gemini** - Both providers now have identical tool capabilities

## How to Test

### 1. Setup Environment

Add your auth token to `.env.local`:

```bash
# Option 1: Use the AI API password
AI_API_PASSWORD=your-secret-password-here

# Option 2: Use a desktop token (validated via Supabase)
DEV_AUTH_TOKEN=your-desktop-token-here
```

**Where to find these:**
- `AI_API_PASSWORD`: Set in your environment variables (check `.env.local` or deployment config)
- Desktop token: Generated via the desktop app authentication flow

### 2. Start the Development Server

```bash
npm run dev
```

Server should be running on `http://localhost:3000`

### 3. Run the Test Suite

```bash
node test-claude-server-tools.mjs
```

**What it tests:**
- ✅ Claude with knowledge base search
- ✅ Claude with documentation search  
- ✅ Comparison: Claude vs Gemini (same behavior)
- ✅ Session continuity with server tools

### 4. What to Look For

#### In Terminal Output (Test Script):

```
✅ Test completed!
📊 Expected server logs:
  - "🛠️ Tools available: 0 client, 2 server"
  - "🔧 Executing server-side tool: search_similar_workflow_steps"
  - "✅ Server tool search_similar_workflow_steps executed successfully"
  - "🔄 Auto-continuing with 1 server tool results"
```

#### In Server Logs (Dev Console):

Look for these log messages:

```
[AI API] 🤖 Calling Anthropic with model claude-sonnet-4-5-20250929
🛠️ Tools available: 0 client, 2 server
[ANTHROPIC] Converting 2 tools to Anthropic format
📊 Anthropic response: { textLen: 0, toolCallsCount: 1, finishReason: 'tool_calls', elapsedMs: 1234 }
🔧 Executing server-side tool: search_similar_workflow_steps
[SERVER-KNOWLEDGE-SEARCH] Searching: { similarity_query: '...' }
✅ Server tool search_similar_workflow_steps executed successfully
🔄 Auto-continuing with 1 server tool results
🎯 Continuation result: { textLen: 456, toolCallsCount: 0, finishReason: 'stop' }
```

### 5. Alternative: Manual cURL Test

```bash
# Test Claude with server tools
curl -X POST http://localhost:3000/api/ai \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_PASSWORD" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "input": "Find a workflow step that submits a form",
    "system": "Use the search_similar_workflow_steps tool to find examples.",
    "generationConfig": {
      "temperature": 0.3,
      "maxOutputTokens": 2000
    }
  }'
```

**Expected response:**
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "sessionId": "uuid-here",
  "text": "I found a relevant workflow step...",
  "toolCalls": [],  // Empty because server tool was auto-executed
  "finishReason": "stop",
  "metrics": {
    "elapsedMs": 1234
  }
}
```

### 6. Compare with Gemini

Test the same request with Gemini to verify identical behavior:

```bash
curl -X POST http://localhost:3000/api/ai \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_PASSWORD" \
  -d '{
    "model": "gemini-2.5-flash",
    "input": "Find a workflow step that submits a form",
    "system": "Use the search_similar_workflow_steps tool to find examples.",
    "generationConfig": {
      "temperature": 0.3,
      "maxOutputTokens": 2000
    }
  }'
```

Both should return a text response (not tool calls), indicating server tools were auto-executed.

## Verification Checklist

- [ ] Claude sees 2 server tools in logs (`🛠️ Tools available: 0 client, 2 server`)
- [ ] Claude calls server tools when appropriate
- [ ] Server tools execute automatically (check for `🔧 Executing server-side tool` logs)
- [ ] Continuation happens automatically (`🔄 Auto-continuing with N server tool results`)
- [ ] Response includes AI text (not just tool calls)
- [ ] Session continuity works (follow-up questions remember previous results)
- [ ] Behavior matches Gemini/Vertex (feature parity)

## Troubleshooting

### "Unauthorized" Error
- Check `AI_API_PASSWORD` in `.env.local`
- Or use a valid desktop token as `DEV_AUTH_TOKEN`

### Tools Not Executing
- Check server logs for "🛠️ Tools available" - should show 2 server tools
- Verify `ANTHROPIC_API_KEY` is set in environment
- Check for error logs: `❌ Server tool X failed`

### No Auto-Continuation
- Server should log `🔄 Auto-continuing with N server tool results`
- If missing, check `isServerSideTool()` is identifying tools correctly

### Different Behavior vs Gemini
- Both should execute server tools the same way
- Check logs to see if one provider is getting tools but the other isn't
- Verify tool format conversion in `convertToAnthropicTools()`

## Additional Tests

### Test with Client Tools

Try mixing client and server tools:

```javascript
{
  "model": "claude-sonnet-4-5-20250929",
  "input": "Search for a workflow about clicking buttons",
  "system": "Use tools as needed.",
  "tools": [
    {
      "name": "custom_client_tool",
      "description": "A custom client-side tool",
      "parameters": {
        "type": "object",
        "properties": {
          "param": { "type": "string" }
        }
      }
    }
  ],
  "generationConfig": {
    "temperature": 0.3,
    "maxOutputTokens": 2000
  }
}
```

Expected: Server tools execute automatically, client tools return in `toolCalls` array for frontend execution.

## Success Criteria

✅ **The fix is working if:**
1. Claude can access both server-side tools
2. Server tools execute without client interaction
3. Claude automatically continues conversation after server tool execution
4. Response includes meaningful text (not just tool call requests)
5. Behavior matches Gemini/Vertex exactly

🎉 **Feature parity achieved!**

