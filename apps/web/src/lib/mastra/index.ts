import { Mastra, Agent } from '@mastra/core';
import { createVertex } from '@ai-sdk/google-vertex';

// Initialize Vertex AI provider
function getVertexAIProvider() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS_BASE64');
  }

  const credentialsJson = Buffer.from(
    process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
    'base64'
  ).toString('utf-8');

  const credentials = JSON.parse(credentialsJson);

  return createVertex({
    project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
    location: process.env.VERTEX_AI_LOCATION || 'us-central1',
    googleAuthOptions: {
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
    },
  });
}

// Get the Vertex provider instance
const vertexProvider = getVertexAIProvider();

// Create the workflow agent
const workflowAgent = new Agent({
  name: 'workflowAgent',
  instructions: 'You are a helpful AI assistant that helps users automate tasks and run workflows. You have access to various tools to help users automate their workflows.',
  model: vertexProvider('gemini-2.5-pro'),
});

// Initialize Mastra with the agent
export const mastra = new Mastra({
  agents: { workflowAgent },
});
