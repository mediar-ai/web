# AI API Documentation

This API provides access to Google Vertex AI models through a simple REST interface with basic authentication.

## Setup

### 1. Install Dependencies

The required dependencies should already be installed:
```bash
npm install @ai-sdk/google-vertex ai
```

### 2. Environment Configuration

Create a `.env.local` file in your project root with the following variables:

```env
# AI API Configuration
AI_API_PASSWORD=your-secret-password-here

# Google Cloud Vertex AI Configuration
GOOGLE_VERTEX_PROJECT=your-google-cloud-project-id
GOOGLE_VERTEX_LOCATION=us-central1

# For Node.js runtime (service account file path)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/service-account-key.json

# For Edge runtime (service account credentials)
GOOGLE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----"
GOOGLE_PRIVATE_KEY_ID=your-private-key-id
```

### 3. Google Cloud Setup

1. Create a Google Cloud Project
2. Enable the Vertex AI API
3. Create a service account with Vertex AI permissions
4. Download the service account key JSON file
5. Set the appropriate environment variables

## API Endpoints

### Base URL
```
/api/ai
```

### Authentication

All requests require authentication using one of these methods:

**Bearer Token:**
```bash
Authorization: Bearer your-secret-password-here
```

**Basic Auth:**
```bash
Authorization: Basic base64(username:your-secret-password-here)
```

## Endpoints

### GET `/api/ai` - Health Check

Check API status and get available models.

**Response:**
```json
{
  "status": "ok",
  "message": "AI API is running",
  "availableModels": [
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-2.0-flash-001",
    "gemini-2.0-flash-exp"
  ],
  "endpoints": {
    "generate": {
      "method": "POST",
      "description": "Generate text using AI",
      "parameters": {
        "prompt": "string (required) - The input prompt",
        "model": "string (optional) - Model name, default: gemini-1.5-pro",
        "stream": "boolean (optional) - Enable streaming response, default: false",
        "maxTokens": "number (optional) - Maximum tokens to generate, default: 1000",
        "temperature": "number (optional) - Creativity level 0-1, default: 0.7",
        "systemPrompt": "string (optional) - System prompt for the AI"
      }
    }
  }
}
```

### POST `/api/ai` - Generate Text

Generate text using AI models.

**Request Body:**
```json
{
  "prompt": "Explain quantum computing in simple terms",
  "model": "gemini-1.5-pro",
  "stream": false,
  "maxTokens": 1000,
  "temperature": 0.7,
  "systemPrompt": "You are a helpful AI assistant."
}
```

**Response (Non-streaming):**
```json
{
  "text": "Quantum computing is a revolutionary technology...",
  "usage": {
    "promptTokens": 15,
    "completionTokens": 200,
    "totalTokens": 215
  },
  "model": "gemini-1.5-pro"
}
```

**Response (Streaming):**
```
data: {"text": "Quantum"}
data: {"text": " computing"}
data: {"text": " is"}
...
data: [DONE]
```

## Usage Examples

### Using cURL

**Health Check:**
```bash
curl -X GET "http://localhost:3000/api/ai" \
  -H "Authorization: Bearer your-secret-password-here"
```

**Generate Text:**
```bash
curl -X POST "http://localhost:3000/api/ai" \
  -H "Authorization: Bearer your-secret-password-here" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a short poem about AI",
    "model": "gemini-1.5-pro",
    "temperature": 0.8
  }'
```

**Streaming Response:**
```bash
curl -X POST "http://localhost:3000/api/ai" \
  -H "Authorization: Bearer your-secret-password-here" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Tell me a story",
    "stream": true
  }'
```

### Using JavaScript/TypeScript

**Basic Usage:**
```typescript
import { AIClient } from '@/lib/ai-client';

const client = new AIClient('your-secret-password-here');

// Simple text generation
const response = await client.generateText({
  prompt: 'Explain machine learning',
  model: 'gemini-1.5-pro'
});

console.log(response.text);
```

**Streaming:**
```typescript
for await (const chunk of client.generateTextStream({
  prompt: 'Write a long story about space exploration',
  model: 'gemini-1.5-pro'
})) {
  console.log(chunk.text);
}
```

**Using Helper Methods:**
```typescript
// Simple ask
const answer = await client.ask('What is the capital of France?');

// Chat with system prompt
const response = await client.chat(
  'How do I bake a cake?',
  'You are a professional chef'
);
```

### Using in React Components

```tsx
import { useState, useEffect } from 'react';
import { AIClient } from '@/lib/ai-client';

export function ChatComponent() {
  const [client, setClient] = useState<AIClient | null>(null);
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Initialize client (get API key from your app's config)
    const apiKey = process.env.NEXT_PUBLIC_AI_API_KEY || 'your-api-key';
    setClient(new AIClient(apiKey));
  }, []);

  const handleSubmit = async (prompt: string) => {
    if (!client) return;
    
    setLoading(true);
    try {
      const result = await client.generateText({
        prompt,
        temperature: 0.7
      });
      setResponse(result.text);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  // ... rest of component
}
```

### Using with Streaming in React

```tsx
import { useState } from 'react';
import { AIClient } from '@/lib/ai-client';

export function StreamingChat() {
  const [response, setResponse] = useState('');
  const [streaming, setStreaming] = useState(false);

  const handleStreamingRequest = async (prompt: string) => {
    const client = new AIClient('your-api-key');
    setResponse('');
    setStreaming(true);

    try {
      for await (const chunk of client.generateTextStream({ prompt })) {
        setResponse(prev => prev + chunk.text);
      }
    } catch (error) {
      console.error('Streaming error:', error);
    } finally {
      setStreaming(false);
    }
  };

  // ... rest of component
}
```

## Available Models

- `gemini-1.5-pro` - Most capable model, best for complex tasks
- `gemini-1.5-flash` - Fast and efficient for simpler tasks
- `gemini-2.0-flash-001` - Latest generation model
- `gemini-2.0-flash-exp` - Experimental version with latest features

## Error Handling

The API returns appropriate HTTP status codes:

- `200` - Success
- `400` - Bad Request (missing required parameters)
- `401` - Unauthorized (invalid credentials)
- `500` - Internal Server Error

**Error Response Format:**
```json
{
  "error": "Error message",
  "details": "Additional error details"
}
```

## Security Notes

1. **Authentication**: Uses simple password-based authentication. For production, consider implementing more robust authentication (JWT, OAuth, etc.)

2. **Rate Limiting**: Consider implementing rate limiting to prevent abuse

3. **Environment Variables**: Never commit sensitive credentials to version control

4. **HTTPS**: Always use HTTPS in production

5. **API Key Management**: Store API keys securely and rotate them regularly

## Troubleshooting

### Common Issues

1. **Authentication Errors**: Verify your API password is set correctly in environment variables

2. **Google Cloud Errors**: Ensure your service account has proper Vertex AI permissions

3. **Model Not Found**: Check if the model name is correct and available in your region

4. **Quota Exceeded**: Check your Google Cloud quotas and billing

### Debug Mode

Set `NODE_ENV=development` to see detailed error logs in the console.

## Rate Limits and Quotas

Respect Google Vertex AI's rate limits and quotas. Consider implementing:

1. Request queuing for high-volume applications
2. Exponential backoff for retries
3. Caching for frequently requested content
4. User-based rate limiting

## Next Steps

1. Implement proper authentication (JWT, OAuth)
2. Add request logging and monitoring
3. Implement rate limiting
4. Add request validation middleware
5. Add support for file uploads and multimodal inputs
6. Add conversation history management
7. Implement request caching