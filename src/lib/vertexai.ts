import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
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
      // 🔄 Automatically map model names to Vertex AI equivalents
      const vertexModelName = getVertexModelName(config.model);
      console.log(`🤖 Using Vertex AI model: ${vertexModelName}`);
      
      return vertexAI.getGenerativeModel({
        model: vertexModelName,
        safetySettings: config.safetySettings,
      });
    }
  };
}

// Export types for compatibility
export type { SafetySetting, GenerateContentRequest };

// Helper function to get the right model name for Vertex AI
export function getVertexModelName(inputModelName: string): string {
  // Map Google AI Studio model names to Vertex AI model names
  const modelMap: Record<string, string> = {
    // 🔥 STABLE MODELS (Production Ready)
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-2.5-pro-preview-06-05': 'gemini-2.5-pro', // Map preview to stable
    'gemini-2.5-pro-preview-05-06': 'gemini-2.5-pro', // Map preview to stable
    'gemini-2.5-pro-preview-03-25': 'gemini-2.5-pro', // Map preview to stable
    
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-2.5-flash-preview-05-20': 'gemini-2.5-flash', // Map preview to stable
    'gemini-2.5-flash-preview-04-17': 'gemini-2.5-flash', // Map preview to stable
    
    'gemini-2.0-flash': 'gemini-2.0-flash-001',
    'gemini-2.0-flash-001': 'gemini-2.0-flash-001',
    
    'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite-001',
    'gemini-2.0-flash-lite-001': 'gemini-2.0-flash-lite-001',
    
    // 🧪 PREVIEW MODELS (Testing Only)
    'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite-preview-06-17',
    'gemini-2.5-flash-lite-preview-06-17': 'gemini-2.5-flash-lite-preview-06-17',
    
    // 🏚️ LEGACY MODELS (Will be retired)
    'gemini-1.5-pro': 'gemini-1.5-pro-002',
    'gemini-1.5-pro-002': 'gemini-1.5-pro-002',
    'gemini-1.5-flash': 'gemini-1.5-flash-002',
    'gemini-1.5-flash-002': 'gemini-1.5-flash-002',
  };
  
  const mappedModel = modelMap[inputModelName];
  
  if (!mappedModel) {
    console.warn(`⚠️ Unknown model name: ${inputModelName}, falling back to gemini-2.5-flash`);
    return 'gemini-2.5-flash'; // Safe default
  }
  
  console.log(`🔄 Model mapping: ${inputModelName} → ${mappedModel}`);
  return mappedModel;
}

// Get generative model directly (for advanced usage)
export function getVertexAIModel(modelName: string) {
  const vertexModelName = getVertexModelName(modelName);
  return vertexAI.preview.getGenerativeModel({
    model: vertexModelName,
  });
}

// Helper function for structured output calls
export async function callVertexWithStructuredOutput(
  prompt: string, 
  context: object, 
  modelName: string, 
  responseSchema: object,
  responseMimeType: string = "application/json"
) {
  console.log('🚀 Using Vertex AI with structured output for model:', modelName);
  const genAI = getVertexGenAI();
  const model = genAI.getGenerativeModel({
    model: modelName,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ],
  });
  
  const fullPrompt = `${prompt}\n\nContext:\n${JSON.stringify(context, null, 2)}`;
  
  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: {
        responseMimeType,
        responseSchema,
      },
    });
    
    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      const rawText = response.candidates[0].content.parts[0].text;
      console.log('✅ Vertex AI structured output successful');
      
      // For JSON responses, parse the result
      if (responseMimeType === "application/json") {
        try {
          // Clean up any markdown formatting that might be present
          let cleanedText = rawText.trim();
          
          // Remove markdown code block markers if present
          if (cleanedText.startsWith('```json')) {
            cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
          } else if (cleanedText.startsWith('```')) {
            cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
          }
          
          // Remove any leading/trailing backticks or other markdown artifacts
          cleanedText = cleanedText.replace(/^`+|`+$/g, '').trim();
          
          console.log('🧹 Cleaned JSON text:', cleanedText.substring(0, 200) + (cleanedText.length > 200 ? '...' : ''));
          
          return JSON.parse(cleanedText);
        } catch (parseError) {
          console.error('❌ Failed to parse structured JSON response:', parseError);
          console.error('❌ Raw response text:', rawText);
          throw new Error(`Invalid JSON response from Vertex AI: ${parseError instanceof Error ? parseError.message : 'Unknown parsing error'}`);
        }
      }
      
      // For enum responses, return the raw text
      return rawText;
    }
    
    console.error("No valid response from Vertex AI model:", response);
    throw new Error('Failed to get valid response from Vertex AI model');
  } catch (error) {
    console.error('Error in callVertexWithStructuredOutput:', error);
    throw new Error(`Failed to get structured response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
} 