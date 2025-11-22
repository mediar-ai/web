/**
 * Vertex AI Text Embeddings for RPA Knowledgebase
 * Uses text-embedding-004 model (768 dimensions)
 */

/**
 * Generate a single embedding using Vertex AI text-embedding-004
 * @param text Text to embed (max ~20,000 characters)
 * @param dimensions Output dimensions (default 768, can be 256 or 512)
 * @returns Array of numbers representing the embedding vector
 */
export async function generateEmbedding(
  text: string,
  dimensions: 256 | 512 | 768 = 768
): Promise<number[]> {
  try {
    const project = process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022';
    const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

    // Truncate to max length (20k chars = ~5k tokens)
    const truncatedText = text.slice(0, 20000);

    // Call Vertex AI Embedding API
    const response = await fetch(
      `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/text-embedding-004:predict`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getAccessToken()}`,
        },
        body: JSON.stringify({
          instances: [
            {
              content: truncatedText,
              task_type: 'RETRIEVAL_DOCUMENT', // Optimized for semantic search
            },
          ],
          parameters: {
            outputDimensionality: dimensions,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vertex AI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.predictions || data.predictions.length === 0) {
      throw new Error('No embeddings returned from Vertex AI');
    }

    return data.predictions[0].embeddings.values;
  } catch (error) {
    console.error('❌ Failed to generate embedding:', error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts in batch
 * @param texts Array of texts to embed
 * @param dimensions Output dimensions (default 768)
 * @returns Array of embedding vectors
 */
export async function generateEmbeddingBatch(
  texts: string[],
  dimensions: 256 | 512 | 768 = 768
): Promise<number[][]> {
  try {
    const project = process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022';
    const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

    // Truncate all texts
    const truncatedTexts = texts.map((t) => t.slice(0, 20000));

    // Prepare instances for batch request
    const instances = truncatedTexts.map((text) => ({
      content: text,
      task_type: 'RETRIEVAL_DOCUMENT',
    }));

    // Call Vertex AI Embedding API with batch
    const response = await fetch(
      `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/text-embedding-004:predict`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getAccessToken()}`,
        },
        body: JSON.stringify({
          instances,
          parameters: {
            outputDimensionality: dimensions,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vertex AI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.predictions || data.predictions.length === 0) {
      throw new Error('No embeddings returned from Vertex AI');
    }

    return data.predictions.map((p: any) => p.embeddings.values);
  } catch (error) {
    console.error('❌ Failed to generate batch embeddings:', error);
    throw error;
  }
}

/**
 * Generate embedding for a query (optimized for search)
 * @param queryText Search query text
 * @param dimensions Output dimensions (default 768)
 * @returns Embedding vector optimized for retrieval
 */
export async function generateQueryEmbedding(
  queryText: string,
  dimensions: 256 | 512 | 768 = 768
): Promise<number[]> {
  try {
    const project = process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022';
    const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

    const truncatedText = queryText.slice(0, 20000);

    const response = await fetch(
      `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/text-embedding-004:predict`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getAccessToken()}`,
        },
        body: JSON.stringify({
          instances: [
            {
              content: truncatedText,
              task_type: 'RETRIEVAL_QUERY', // Optimized for queries
            },
          ],
          parameters: {
            outputDimensionality: dimensions,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vertex AI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.predictions || data.predictions.length === 0) {
      throw new Error('No embeddings returned from Vertex AI');
    }

    return data.predictions[0].embeddings.values;
  } catch (error) {
    console.error('❌ Failed to generate query embedding:', error);
    throw error;
  }
}

/**
 * Helper to get access token for Vertex AI
 */
async function getAccessToken(): Promise<string> {
  // Use GoogleAuth to get token
  const { GoogleAuth } = await import('google-auth-library');
  
  // Detect credentials
  const hasDirectCredentials = !!(
    process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY
  );
  const hasBase64Credentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;

  let auth: InstanceType<typeof GoogleAuth>;

  if (hasDirectCredentials) {
    auth = new GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL!,
        private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  } else if (hasBase64Credentials) {
    const credentialsJson = Buffer.from(
      process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64!,
      'base64'
    ).toString('utf-8');
    const credentials = JSON.parse(credentialsJson);

    auth = new GoogleAuth({
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  } else {
    auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  
  if (!tokenResponse.token) {
    throw new Error('Failed to get access token');
  }

  return tokenResponse.token;
}

/**
 * Generate all three embeddings for a knowledgebase step
 * @param step Step data containing definition, workflow info, and outcome
 * @returns Object with all three embeddings
 */
export async function generateStepEmbeddings(step: {
  step_name: string;
  definition?: string;
  workflow_name: string;
  workflow_description?: string;
  expected_outcome?: any;
}): Promise<{
  definition_embedding: number[];
  workflow_embedding: number[];
  outcome_embedding: number[];
}> {
  // Prepare texts for embedding
  const definitionText = `${step.step_name}\n${step.definition || ''}`;
  const workflowText = `${step.workflow_name}\n${step.workflow_description || ''}`;
  const outcomeText = step.expected_outcome
    ? typeof step.expected_outcome === 'string'
      ? step.expected_outcome
      : JSON.stringify(step.expected_outcome)
    : '';

  // Generate all embeddings in parallel
  const [definition_embedding, workflow_embedding, outcome_embedding] =
    await Promise.all([
      generateEmbedding(definitionText),
      generateEmbedding(workflowText),
      outcomeText ? generateEmbedding(outcomeText) : Promise.resolve(new Array(768).fill(0)),
    ]);

  return {
    definition_embedding,
    workflow_embedding,
    outcome_embedding,
  };
}

/**
 * Estimate cost for embedding generation
 * @param textLength Total characters to embed
 * @returns Estimated cost in USD
 */
export function estimateEmbeddingCost(textLength: number): number {
  // Vertex AI text-embedding-004: $0.025 per 1M characters
  const costPerChar = 0.025 / 1_000_000;
  return textLength * costPerChar;
}

