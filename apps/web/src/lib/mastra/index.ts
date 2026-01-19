import { Mastra, Agent } from '@mastra/core';
import { createVertex } from '@ai-sdk/google-vertex';

// Cached instances for lazy initialization
let _vertexProvider: ReturnType<typeof createVertex> | null = null;
let _mastra: Mastra | null = null;

// Initialize Vertex AI provider (lazy - only when first called)
function getVertexAIProvider() {
  if (_vertexProvider) return _vertexProvider;

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS_BASE64');
  }

  const credentialsJson = Buffer.from(
    process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
    'base64'
  ).toString('utf-8');

  const credentials = JSON.parse(credentialsJson);

  _vertexProvider = createVertex({
    project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
    location: process.env.VERTEX_AI_LOCATION || 'us-central1',
    googleAuthOptions: {
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
    },
  });

  return _vertexProvider;
}

// Get or create the Mastra instance (lazy initialization)
function getMastra(): Mastra {
  if (_mastra) return _mastra;

  const vertexProvider = getVertexAIProvider();

  const workflowAgent = new Agent({
    name: 'workflowAgent',
    instructions: 'You are a helpful AI assistant that helps users automate tasks and run workflows. You have access to various tools to help users automate their workflows.',
    model: vertexProvider('gemini-2.5-pro'),
  });

  _mastra = new Mastra({
    agents: { workflowAgent },
  });

  return _mastra;
}

// Export a proxy that lazily initializes mastra on first access
export const mastra = new Proxy({} as Mastra, {
  get(_target, prop) {
    const instance = getMastra();
    const value = instance[prop as keyof Mastra];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});
