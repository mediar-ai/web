import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';



// Health check utility for long operations
interface HealthCheckOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onHealthIssue?: (issue: string) => void;
}

async function performHealthCheck(options: HealthCheckOptions = {}): Promise<boolean> {
  const { timeoutMs = 5000, onHealthIssue } = options;
  
  try {
    // Check basic server connectivity
    const startTime = Date.now();
    
    // Simple health check - try to create a basic VertexAI instance
    const healthCheck = new Promise((resolve, reject) => {
      try {
        const testVertex = getVertexAIConfig();
        if (testVertex) {
          resolve(true);
        } else {
          reject(new Error('VertexAI instance creation failed'));
        }
      } catch (error) {
        reject(error);
      }
    });
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Health check timeout')), timeoutMs);
    });
    
    await Promise.race([healthCheck, timeoutPromise]);
    
    const elapsed = Date.now() - startTime;
    console.log(`✅ Health check passed in ${elapsed}ms`);
    return true;
    
  } catch (error) {
    const issue = `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.error(`❌ ${issue}`);
    onHealthIssue?.(issue);
    return false;
  }
}

// Enhanced health monitoring during long operations
export async function withHealthMonitoring<T>(
  operation: () => Promise<T>,
  options: HealthCheckOptions & { operationName?: string } = {}
): Promise<T> {
  const { intervalMs = 30000, operationName = 'Operation', onHealthIssue } = options;
  
  console.log(`🏥 Starting health monitoring for ${operationName} (check interval: ${intervalMs}ms)`);
  
  let healthCheckInterval: NodeJS.Timeout | null = null;
  let healthIssueDetected = false;
  
  // Start periodic health checks
  healthCheckInterval = setInterval(async () => {
    console.log(`🏥 Performing health check during ${operationName}...`);
    const healthy = await performHealthCheck({
      ...options,
      onHealthIssue: (issue) => {
        healthIssueDetected = true;
        console.error(`🚨 Health issue detected during ${operationName}: ${issue}`);
        onHealthIssue?.(issue);
      }
    });
    
    if (!healthy) {
      healthIssueDetected = true;
    }
  }, intervalMs);
  
  try {
    // Run the actual operation
    const result = await operation();
    
    // Clear health monitoring
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
    }
    
    if (healthIssueDetected) {
      console.warn(`⚠️ ${operationName} completed but health issues were detected during execution`);
    } else {
      console.log(`✅ ${operationName} completed successfully with no health issues`);
    }
    
    return result;
    
  } catch (error) {
    // Clear health monitoring on error
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
    }
    
    if (healthIssueDetected) {
      console.error(`💥 ${operationName} failed and health issues were also detected`);
      throw new Error(`${operationName} failed with health issues: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } else {
      console.error(`💥 ${operationName} failed but health checks were OK`);
      throw error;
    }
  }
}

// Initialize Google GenAI with Vertex AI backend
const getVertexAIConfig = (locationOverride?: string): GoogleGenAI => {
  const project = process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022';
  const location = locationOverride || process.env.VERTEX_AI_LOCATION || 'us-central1';

  // Detect environment
  const isVercel = process.env.VERCEL === '1';
  const hasFileCredentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const hasBase64Credentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
  const hasDirectCredentials = !!(process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);

  // Common scopes for Google Cloud Platform
  const scopes = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/cloud-platform.read-only'
  ];

  // Method 1: File-based credentials (prioritize for local development)
  if (hasFileCredentials && !isVercel) {
    return new GoogleGenAI({
      vertexai: true,
      project,
      location,
      googleAuthOptions: {
        scopes
      }
    });
  }

  // Method 2: Direct credentials (recommended for Vercel)
  if (hasDirectCredentials) {
    return new GoogleGenAI({
      vertexai: true,
      project,
      location,
      googleAuthOptions: {
        credentials: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL!,
          private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
        },
        scopes
      }
    });
  }

  // Method 3: Base64 credentials (fallback)
  if (hasBase64Credentials) {
    try {
      const base64Credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64!;
      const credentialsJson = Buffer.from(base64Credentials, 'base64').toString('utf-8');
      const credentials = JSON.parse(credentialsJson);

      // Validate required fields
      if (!credentials.client_email || !credentials.private_key) {
        throw new Error('Invalid credentials: missing client_email or private_key');
      }

      return new GoogleGenAI({
        vertexai: true,
        project,
        location,
        googleAuthOptions: {
          credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
          },
          scopes
        }
      });
    } catch (error) {
      console.error('❌ Failed to parse base64 credentials:', error);
      throw new Error(`Invalid base64 credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Fallback: Default credentials
  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
    googleAuthOptions: {
      scopes
    }
  });
};

// Create Google GenAI instance with Vertex AI backend
let genAI: GoogleGenAI;

try {
  genAI = getVertexAIConfig();
  // Google GenAI with Vertex AI backend initialized successfully
} catch (error) {
  console.error('❌ Failed to initialize Google GenAI:', error);
  throw error;
}

// Export a compatible interface for existing code
// Provides getGenerativeModel for backward compatibility
export function getVertexGenAI() {
  return {
    // Direct access to the GenAI instance
    _client: genAI,

    // Backward compatible method that wraps the new SDK
    getGenerativeModel: (config: { model: string; safetySettings?: any[] }) => {
      const vertexModelName = getVertexModelName(config.model);

      return {
        // Wrap generateContent to use the new SDK's models.generateContent
        generateContent: async (params: any) => {
          // Preserve full contents structure including all parts (text AND images)
          // The old SDK format: { contents: [{ role: "user", parts: [{ text: "..." }, { inlineData: {...} }] }] }
          // The new SDK format: { contents: [{ role: "user", parts: [{ text: "..." }, { inlineData: {...} }] }] }
          const contents = params.contents;

          const result = await genAI.models.generateContent({
            model: vertexModelName,
            contents: contents,
            config: {
              ...params.generationConfig,
              safetySettings: config.safetySettings,
            },
          });

          // Return in a format compatible with old SDK
          return {
            response: result,
          };
        },

        // Wrap startChat for chat sessions
        startChat: (chatParams?: any) => {
          // Note: Chat functionality may need additional implementation
          return {
            sendMessage: async (message: string) => {
              const result = await genAI.models.generateContent({
                model: vertexModelName,
                contents: message,
                config: {
                  safetySettings: config.safetySettings,
                  ...chatParams?.generationConfig,
                },
              });

              return {
                response: result,
              };
            },
          };
        },
      };
    },
  };
}

// Helper function to get the right model name for Vertex AI
export function getVertexModelName(inputModelName: string): string {
  // Map Google AI Studio model names to Vertex AI model names
  const modelMap: Record<string, string> = {
    // 🔥 STABLE MODELS (Production Ready - Latest Generation)
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-2.5-pro-preview-06-05': 'gemini-2.5-pro', // Map preview to stable
    'gemini-2.5-pro-preview-05-06': 'gemini-2.5-pro', // Map preview to stable
    'gemini-2.5-pro-preview-03-25': 'gemini-2.5-pro', // Map preview to stable
    
    // 🔥 GEMINI 3 (Latest Generation - requires global endpoint)
    'gemini-3-pro': 'gemini-3-pro-preview',
    'gemini-3-pro-preview': 'gemini-3-pro-preview',

    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-2.5-flash-preview-09-2025': 'gemini-2.5-flash-preview-09-2025', // Latest preview
    'gemini-2.5-flash-preview-05-20': 'gemini-2.5-flash', // Map old preview to stable
    'gemini-2.5-flash-preview-04-17': 'gemini-2.5-flash', // Map old preview to stable
    
    // 🧪 PREVIEW MODELS (Testing Only)
    'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite-preview-06-17',
    'gemini-2.5-flash-lite-preview-06-17': 'gemini-2.5-flash-lite-preview-06-17',
    
    // 🏚️ LEGACY MODELS (Migrated to 2.5 - Deprecated by Google)
    'gemini-2.0-flash': 'gemini-2.5-flash', // Migrate 2.0 to 2.5
    'gemini-2.0-flash-001': 'gemini-2.5-flash', // Migrate 2.0 to 2.5
    'gemini-2.0-flash-exp': 'gemini-2.5-flash', // Migrate experimental to stable 2.5
    'gemini-2.0-flash-lite': 'gemini-2.5-flash', // Migrate 2.0 lite to 2.5
    'gemini-2.0-flash-lite-001': 'gemini-2.5-flash', // Migrate 2.0 lite to 2.5
    'gemini-1.5-pro': 'gemini-2.5-pro', // Migrate 1.5 to 2.5
    'gemini-1.5-pro-002': 'gemini-2.5-pro', // Migrate 1.5 to 2.5
    'gemini-1.5-flash': 'gemini-2.5-flash', // Migrate 1.5 to 2.5
    'gemini-1.5-flash-002': 'gemini-2.5-flash', // Migrate 1.5 to 2.5
  };
  
  const mappedModel = modelMap[inputModelName];

  if (!mappedModel) {
    throw new Error(`Unknown Vertex AI model: ${inputModelName}. Allowed models: ${Object.keys(modelMap).join(', ')}`);
  }

  return mappedModel;
}

// Get generative model name (for advanced usage)
export function getVertexAIModel(modelName: string): string {
  return getVertexModelName(modelName);
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

// Enhanced helper function for structured output calls with timeout and progress tracking
export async function callVertexWithStructuredOutput(
  prompt: string, 
  context: object, 
  modelName: string, 
  responseSchema: object,
  responseMimeType: string = "application/json",
  includeUsageMetadata: boolean = false,
  options: {
    timeoutMs?: number;
    onProgress?: (stage: string, elapsed: number) => void;
    onTimeout?: (elapsed: number) => void;
    maxRetries?: number;
    retryDelayMs?: number;
  } = {}
) {
  const {
    timeoutMs = 900000, // 15 minute default timeout (increased for large batches)
    onProgress,
    onTimeout,
    maxRetries = 2,
    retryDelayMs = 1000
  } = options;

  // Check if this is a Gemini 3 model - requires global endpoint
  const mappedModelName = getVertexModelName(modelName);
  const isGemini3 = mappedModelName.includes('gemini-3');
  const location = isGemini3 ? 'global' : undefined;

  console.log('🚀 Using Vertex AI with structured output for model:', modelName);
  console.log(`🌍 Location: ${location || 'us-central1 (default)'}, isGemini3: ${isGemini3}`);
  console.log(`⏱️ Timeout configured: ${timeoutMs}ms, Max retries: ${maxRetries}`);

  const startTime = Date.now();
  let attempt = 0;

  // Progress tracking
  const reportProgress = (stage: string) => {
    const elapsed = Date.now() - startTime;
    console.log(`📊 [${elapsed}ms] ${stage}`);
    onProgress?.(stage, elapsed);
  };

  reportProgress('Initializing Vertex AI');

  // Use location-specific GenAI instance for Gemini 3
  const genAI = isGemini3 ? getVertexAIConfig('global') : getVertexGenAI()._client;

  // For Gemini 3, use the new SDK directly; for others, use the wrapper
  const model = isGemini3 ? null : getVertexGenAI().getGenerativeModel({
    model: modelName,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ],
  });

  const fullPrompt = `${prompt}\n\nContext:\n${JSON.stringify(context, null, 2)}`;
  console.log(`📏 Full prompt length: ${fullPrompt.length} characters`);
  console.log(`🤖 Using model: ${getVertexModelName(modelName)}`);

  // Retry loop with exponential backoff
  while (attempt <= maxRetries) {
    try {
      attempt++;
      const attemptStartTime = Date.now();
      
      if (attempt > 1) {
        console.log(`🔄 Retry attempt ${attempt}/${maxRetries + 1}`);
        reportProgress(`Starting retry attempt ${attempt}`);
        
        // Wait before retry with exponential backoff
        const delay = retryDelayMs * Math.pow(2, attempt - 2);
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      reportProgress('Sending request to VertexAI');

      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          const elapsed = Date.now() - startTime;
          console.error(`⏰ Request timeout after ${elapsed}ms (limit: ${timeoutMs}ms)`);
          onTimeout?.(elapsed);
          reject(new Error(`VertexAI request timeout after ${elapsed}ms. The model may be overloaded or the prompt too complex.`));
        }, timeoutMs);
      });

      // Create the actual request promise - different path for Gemini 3
      let requestPromise;
      if (isGemini3) {
        // Gemini 3: Use new SDK directly with global endpoint
        requestPromise = genAI.models.generateContent({
          model: mappedModelName,
          contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
          config: {
            responseMimeType,
            responseSchema,
          },
        });
      } else {
        // Other models: Use wrapper
        requestPromise = model!.generateContent({
          contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
          generationConfig: {
            responseMimeType,
            responseSchema,
          },
        });
      }

      reportProgress('Waiting for Vertex AI response');

      // Race between timeout and actual request
      const result = await Promise.race([requestPromise, timeoutPromise]);

      const requestElapsed = Date.now() - attemptStartTime;
      reportProgress(`Received response in ${requestElapsed}ms`);

      // Handle different response structures for Gemini 3 vs other models
      let response;
      if (isGemini3) {
        // Gemini 3: Response is direct from new SDK
        response = result;
      } else {
        // Other models: Response is wrapped
        if (!result || typeof result !== 'object' || !('response' in result)) {
          throw new Error('Invalid response structure from Vertex AI');
        }
        response = (result as { response: any }).response;
      }

      // 🔥 CAPTURE USAGE METADATA FOR TOKEN TRACKING
      const usageMetadata = response?.usageMetadata;
      if (includeUsageMetadata) {
        console.log('📊 Vertex AI usage metadata:', usageMetadata);
      }

      // Extract text from the response
      const rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text ||
                      response?.text ||
                      null;

      if (rawText) {
        reportProgress('Processing response');
        console.log('✅ Vertex AI structured output successful');
        
        let parsedContent;
        
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
            parsedContent = JSON.parse(repairedJson);
            
            reportProgress('Successfully parsed JSON response');
          } catch (parseError) {
            console.error('❌ Failed to parse structured JSON response:', parseError);
            console.error('❌ Raw response text:', rawText);
            
            // If it's our last attempt, throw the error
            if (attempt > maxRetries) {
              throw new Error(`Invalid JSON response from Vertex AI: ${parseError instanceof Error ? parseError.message : 'Unknown parsing error'}`);
            }
            
            // Otherwise, continue to retry
            console.log('🔄 JSON parsing failed, will retry...');
            continue;
          }
        } else {
          // For enum responses, return the raw text
          parsedContent = rawText;
        }
        
        const totalElapsed = Date.now() - startTime;
        reportProgress(`Completed successfully in ${totalElapsed}ms`);
        console.log(`🎉 Request completed successfully in ${totalElapsed}ms after ${attempt} attempt(s)`);
        
        // 🔥 RETURN FORMAT BASED ON includeUsageMetadata FLAG
        if (includeUsageMetadata) {
          return {
            content: parsedContent,
            usage: usageMetadata ? {
              promptTokenCount: usageMetadata.promptTokenCount,
              candidatesTokenCount: usageMetadata.candidatesTokenCount,
              totalTokenCount: usageMetadata.totalTokenCount
            } : null,
            metadata: {
              attempts: attempt,
              totalElapsedMs: totalElapsed,
              requestElapsedMs: requestElapsed
            }
          };
        } else {
          // Backward compatible: return just the content
          return parsedContent;
        }
      }
      
      console.error("No valid response from Google GenAI model:", response);

      // If it's our last attempt, throw the error
      if (attempt > maxRetries) {
        throw new Error('Failed to get valid response from Google GenAI model');
      }
      
      // Otherwise, continue to retry
      console.log('🔄 Invalid response received, will retry...');
      continue;
      
    } catch (error) {
      const elapsed = Date.now() - startTime;
      
      // Check if it's a timeout error
      if (error instanceof Error && error.message.includes('timeout')) {
        console.error(`⏰ Timeout on attempt ${attempt}/${maxRetries + 1} after ${elapsed}ms:`, error.message);
        
        // If it's our last attempt, throw the timeout error
        if (attempt > maxRetries) {
          throw new Error(`VertexAI request failed after ${maxRetries + 1} attempts due to timeout. Total time: ${elapsed}ms. Consider reducing prompt size or increasing timeout.`);
        }
        
        // Otherwise, continue to retry
        continue;
      }
      
      // For other errors, log and retry if we have attempts left
      console.error(`❌ Error on attempt ${attempt}/${maxRetries + 1}:`, error);
      
      // If it's our last attempt, throw the error
      if (attempt > maxRetries) {
        throw new Error(`Failed to get structured response after ${maxRetries + 1} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      
      // Otherwise, continue to retry
      console.log('🔄 Error occurred, will retry...');
      continue;
    }
  }
  
  // This should never be reached due to the throw statements above, but just in case
  throw new Error('Unexpected end of retry loop');
} 