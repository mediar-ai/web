import { VertexAI } from '@google-cloud/vertexai';
import type { SafetySetting, GenerateContentRequest } from '@google-cloud/vertexai';

// Initialize Vertex AI with project and location
const getVertexAIConfig = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: any = {
    project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
    location: process.env.VERTEX_AI_LOCATION || 'us-central1',
  };

  // Handle different credential scenarios
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    // Vercel deployment: decode base64 credentials
    const credentialsJson = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf-8');
    config.googleAuthOptions = {
      credentials: JSON.parse(credentialsJson),
    };
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Local development: use file path
    config.googleAuthOptions = {
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    };
  }
  // If neither is set, it will use default Google Cloud authentication

  return config;
};

const vertex_ai = new VertexAI(getVertexAIConfig());

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

// Create a Google AI Studio compatible interface using Vertex AI
export function getVertexGenAI() {
  return {
    getGenerativeModel: (config: { 
      model: string; 
      generationConfig?: Record<string, unknown>; 
      safetySettings?: SafetySetting[] 
    }) => {
      const vertexModelName = getVertexModelName(config.model);
      
      // Log the model mapping for debugging
      if (config.model !== vertexModelName) {
        console.log(`🔄 Vertex AI: Using ${vertexModelName} (requested: ${config.model})`);
      }
      
      const model = vertex_ai.preview.getGenerativeModel({
        model: vertexModelName,
        generationConfig: config.generationConfig,
        safetySettings: config.safetySettings,
      });
      
      // Wrap the model to match Google AI Studio interface
      return {
        generateContent: async (prompt: string | GenerateContentRequest) => {
          const result = await model.generateContent(prompt);
          
          // Convert Vertex AI response to Google AI Studio format
          return {
            response: {
              text: () => result.response.candidates?.[0]?.content?.parts?.[0]?.text || '',
              candidates: result.response.candidates,
              usageMetadata: result.response.usageMetadata,
            }
          };
        }
      };
    }
  };
}

// Get generative model directly (for advanced usage)
export function getVertexAIModel(modelName: string) {
  const vertexModelName = getVertexModelName(modelName);
  return vertex_ai.preview.getGenerativeModel({
    model: vertexModelName,
  });
} 