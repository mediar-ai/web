import { VertexAI } from '@google-cloud/vertexai';
import type { SafetySetting, GenerateContentRequest } from '@google-cloud/vertexai';

// Initialize Vertex AI with proper credential handling
const getVertexAIConfig = () => {
  const project = process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022';
  const location = process.env.VERTEX_AI_LOCATION || 'us-central1';
  
  // Detect environment
  const isVercel = process.env.VERCEL === '1';
  const hasFileCredentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const hasBase64Credentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
  const hasDirectCredentials = !!(process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
  
  console.log('🔧 Vertex AI Environment Detection:', {
    isVercel,
    hasFileCredentials,
    hasBase64Credentials,
    hasDirectCredentials,
    project,
    location
  });

  // Method 1: File-based credentials (prioritize for local development)
  if (hasFileCredentials && !isVercel) {
    console.log('🔑 Using file-based credentials for Vertex AI');
    
    return new VertexAI({
      project,
      location,
      googleAuthOptions: {
        scopes: [
          'https://www.googleapis.com/auth/cloud-platform',
          'https://www.googleapis.com/auth/cloud-platform.read-only'
        ]
      }
    });
  }

  // Method 2: Direct credentials (recommended for Vercel)
  if (hasDirectCredentials) {
    console.log('🔑 Using direct credentials for Vertex AI');
    
    return new VertexAI({
      project,
      location,
      googleAuthOptions: {
        credentials: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL!,
          private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
        },
        scopes: [
          'https://www.googleapis.com/auth/cloud-platform',
          'https://www.googleapis.com/auth/cloud-platform.read-only'
        ]
      }
    });
  }

  // Method 3: Base64 credentials (fallback)
  if (hasBase64Credentials) {
    console.log('🔑 Using base64 credentials for Vertex AI');
    
    try {
      const base64Credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64!;
      const credentialsJson = Buffer.from(base64Credentials, 'base64').toString('utf-8');
      const credentials = JSON.parse(credentialsJson);
      
      // Validate required fields
      if (!credentials.client_email || !credentials.private_key) {
        throw new Error('Invalid credentials: missing client_email or private_key');
      }
      
      return new VertexAI({
        project,
        location,
        googleAuthOptions: {
          credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
          },
          scopes: [
            'https://www.googleapis.com/auth/cloud-platform',
            'https://www.googleapis.com/auth/cloud-platform.read-only'
          ]
        }
      });
    } catch (error) {
      console.error('❌ Failed to parse base64 credentials:', error);
      throw new Error(`Invalid base64 credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Fallback: Default credentials
  console.log('🔑 Using default credentials for Vertex AI');
  return new VertexAI({
    project,
    location,
    googleAuthOptions: {
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/cloud-platform.read-only'
      ]
    }
  });
};

// Create Vertex AI instance
let vertexAI: VertexAI;

try {
  vertexAI = getVertexAIConfig();
  console.log('✅ Vertex AI initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize Vertex AI:', error);
  throw error;
}

// Create a Google AI Studio-compatible interface
export function getVertexGenAI() {
  return {
    getGenerativeModel: (config: { model: string; safetySettings?: SafetySetting[] }) => {
      console.log(`🤖 Using Vertex AI model: ${config.model}`);
      
      return vertexAI.getGenerativeModel({
        model: config.model,
        safetySettings: config.safetySettings,
      });
    }
  };
}

// Export types for compatibility
export type { SafetySetting, GenerateContentRequest };

// Export HarmCategory and HarmBlockThreshold from Vertex AI
export { HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';

// Helper function to get the right model name for Vertex AI
export function getVertexModelName(studioModelName: string): string {
  // Map to actual Vertex AI model names from Google Cloud platform
  const modelMap: Record<string, string> = {
    // Generally available Gemini models (from Vertex AI platform)
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-2.0-flash': 'gemini-2.0-flash',
    'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite',
    
    // Preview models
    'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
    
    // Legacy models
    'gemini-2.0-flash-exp': 'gemini-2.0-flash-exp',
    'gemini-1.5-pro': 'gemini-1.5-pro',
    'gemini-1.5-flash': 'gemini-1.5-flash',
  };
  
  return modelMap[studioModelName] || 'gemini-2.5-flash'; // Default to generally available model
}

// Get generative model directly (for advanced usage)
export function getVertexAIModel(modelName: string) {
  const vertexModelName = getVertexModelName(modelName);
  return vertexAI.preview.getGenerativeModel({
    model: vertexModelName,
  });
} 