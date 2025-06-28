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
  
  // Environment detection (debug logs removed for cleaner output)

  // Method 1: File-based credentials (prioritize for local development)
  if (hasFileCredentials && !isVercel) {
    // Using file-based credentials
    
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
    // Using direct credentials
    
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
    // Using base64 credentials
    
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
  // Using default credentials
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
  // Vertex AI initialized successfully
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
      // Using Vertex AI model: ${vertexModelName}
      
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
  
  // Model mapping: ${inputModelName} → ${mappedModel}
  return mappedModel;
}

// Get generative model directly (for advanced usage)
export function getVertexAIModel(modelName: string) {
  const vertexModelName = getVertexModelName(modelName);
  return vertexAI.preview.getGenerativeModel({
    model: vertexModelName,
  });
}

/**
 * JSON repair function to handle malformed responses from Vertex AI
 * 
 * Common issues this fixes:
 * - Unterminated strings (e.g., "what_was_typed": "text without closing quote)
 * - Unescaped newlines within JSON strings  
 * - Truncated JSON responses
 * - Missing closing braces
 * - Trailing commas
 * 
 * @param jsonString The potentially malformed JSON string from Vertex AI
 * @returns Repaired JSON string that should parse successfully
 */
function repairMalformedJson(jsonString: string): string {
  let repaired = jsonString.trim();
  
  // Track if we made any repairs for logging
  const repairsMade: string[] = [];
  
  try {
    // First, try to parse as-is to see if repair is needed
    JSON.parse(repaired);
    return repaired; // Already valid JSON
  } catch {
    // JSON is malformed, attempt repairs
  }
  
  // 1. Fix unterminated strings by finding the last quote and ensuring proper closure
  const lines = repaired.split('\n');
  let inString = false;
  let stringChar = null;
  let lastValidLine = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let j = 0;
    
    while (j < line.length) {
      const char = line[j];
      const prevChar = j > 0 ? line[j - 1] : null;
      
      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar && prevChar !== '\\') {
        inString = false;
        stringChar = null;
      }
      j++;
    }
    
    if (!inString) {
      lastValidLine = i;
    }
  }
  
  // If we have an unterminated string, truncate to last valid line and try to close the JSON
  if (inString && lastValidLine >= 0) {
    const truncatedLines = lines.slice(0, lastValidLine + 1);
    let truncated = truncatedLines.join('\n');
    
    // Try to properly close the JSON structure
    const openBraces = (truncated.match(/\{/g) || []).length;
    const closeBraces = (truncated.match(/\}/g) || []).length;
    const missingBraces = openBraces - closeBraces;
    
    if (missingBraces > 0) {
      // Add missing closing braces
      truncated += '\n' + '}'.repeat(missingBraces);
      repairsMade.push(`added ${missingBraces} missing closing braces`);
    }
    
    repaired = truncated;
    repairsMade.push('truncated unterminated string');
  }
  
  // 2. Fix common escape sequence issues within JSON strings
  repaired = repaired.replace(/"([^"]*?)\\n\\n([^"]*?)$/gm, (match, before, after) => {
    // If line ends without closing quote, add it
    if (!after.includes('"')) {
      repairsMade.push('closed unterminated string with newlines');
      return `"${before}\\n\\n${after}"`;
    }
    return match;
  });
  
  // 3. Fix unescaped newlines within JSON strings
  repaired = repaired.replace(/"([^"]*?)\n([^"]*?)"/g, (match, before, after) => {
    repairsMade.push('escaped unescaped newlines');
    return `"${before}\\n${after}"`;
  });
  
  // 4. Fix trailing commas
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
  if (repaired.includes(',}') || repaired.includes(',]')) {
    repairsMade.push('removed trailing commas');
  }
  
  // 5. Ensure proper JSON structure closure
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  
  if (openBraces > closeBraces) {
    const missing = openBraces - closeBraces;
    repaired += '\n' + '}'.repeat(missing);
    repairsMade.push(`added ${missing} missing closing braces`);
  }
  
  // Log repairs made
  if (repairsMade.length > 0) {
    console.log('🔧 JSON repairs made:', repairsMade.join(', '));
  }
  
  return repaired;
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
          
          // Attempt to repair malformed JSON before parsing
          const repairedJson = repairMalformedJson(cleanedText);
          return JSON.parse(repairedJson);
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