/**
 * Server-side knowledge tools that execute directly on the backend
 * No round-trip to client needed - direct database access
 *
 * DEPRECATED tools moved to desktop app:
 * - get_terminator_api_docs, search_terminator_api, get_tool_details -> desktop app knowledge-tools.ts
 * - workflow-editing-tools -> TypeScript file-based editing on desktop
 * - dev-log-tools -> removed (not actively used)
 */

import { createClient } from '@supabase/supabase-js';
import { generateQueryEmbedding } from '@/lib/vertex-embeddings';
import { Type } from '@/app/api/ai/types/vertex';

// Alias for backward compatibility
const SchemaType = Type;

// Lazy-load Supabase client to avoid initialization errors
let supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabaseClient() {
  if (!supabaseClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error('Missing Supabase environment variables');
    }

    supabaseClient = createClient(url, key);
  }
  return supabaseClient;
}

interface SearchResult {
  step_id: string;
  app_name: string;
  window_title: string;
  step_name: string;
  definition: string;
  workflow_name: string;
  ranking: number;
  keyword_rank: number | null;
  similarity_score: number;
  combined_score: number;
}

/**
 * Server-side tools that can be executed directly without client round-trip
 */
export const serverSideTools = {
  search_similar_workflow_steps: {
    description: 'Search the knowledgebase for similar workflow steps and examples. Returns the BEST matching step from previous workflows. Use this when the user asks to find existing patterns, examples, or similar automation steps.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        search_query: {
          type: SchemaType.STRING,
          description: 'Text-based keyword search query. Example: "form submission validation"'
        },
        similarity_query: {
          type: SchemaType.STRING,
          description: 'Semantic/natural language description of what to find. Example: "submit a web form with error handling". This is the primary search method.'
        },
        embedding_type: {
          type: SchemaType.STRING,
          enum: ['workflow', 'definition', 'outcome'],
          description: 'Type of content to search. Use "workflow" for complete workflows (default), "definition" for step code definitions, "outcome" for expected outcomes.',
          default: 'workflow'
        }
      },
      required: ['similarity_query']
    },
    execute: async (params: {
      search_query?: string;
      similarity_query: string;
      embedding_type?: string;
    }) => {
      try {
        console.log('[SERVER-KNOWLEDGE-SEARCH] Searching:', params);

        // Generate query embedding for similarity search
        let query_embedding = null;
        if (params.similarity_query) {
          console.log('[SERVER-KNOWLEDGE-SEARCH] Generating embedding...');
          query_embedding = await generateQueryEmbedding(params.similarity_query);
          console.log('[SERVER-KNOWLEDGE-SEARCH] Embedding generated');
        }

        // Direct database call - no HTTP request needed!
        // Type assertion needed because createClient doesn't have database schema types
        const { data, error } = await (getSupabaseClient().rpc as any)('search_rpa_kb_two_stage', {
          search_query: params.search_query || params.similarity_query,
          query_embedding: query_embedding ? `[${query_embedding.join(',')}]` : null,
          embedding_type: params.embedding_type || 'workflow',
          filter_app: null,
          filter_window: null,
          filter_workflow: null,
          filter_author: null,
          filter_environment: null,
          stage1_limit: 500,
          stage2_limit: 1  // Return only the best match
        });

        if (error) {
          console.error('[SERVER-KNOWLEDGE-SEARCH] Database error:', error);
          throw new Error(`Database search failed: ${error.message}`);
        }

        console.log('[SERVER-KNOWLEDGE-SEARCH] Search complete, found:', Array.isArray(data) ? data.length : 0, 'results');

        // Check if search was successful
        if (!data || !Array.isArray(data) || data.length === 0) {
          return {
            action: 'search_completed',
            query: params.similarity_query,
            found: false,
            message: 'No similar workflow steps found in the knowledgebase.'
          };
        }

        // Take only the first (best) result
        const bestResult = data[0] as SearchResult;
        console.log('[SERVER-KNOWLEDGE-SEARCH] Best result:', {
          step_name: bestResult.step_name,
          workflow_name: bestResult.workflow_name,
          similarity_score: bestResult.similarity_score
        });

        // Format the best result for AI to use
        return {
          action: 'search_completed',
          query: params.similarity_query,
          found: true,
          result: {
            step_id: bestResult.step_id,
            step_name: bestResult.step_name,
            definition: bestResult.definition,
            workflow_name: bestResult.workflow_name,
            app_name: bestResult.app_name,
            window_title: bestResult.window_title,
            similarity_score: bestResult.similarity_score,
            combined_score: bestResult.combined_score
          }
        };
      } catch (error) {
        console.error('[SERVER-KNOWLEDGE-SEARCH] Error:', error);
        return {
          action: 'search_failed',
          query: params.similarity_query,
          error: error instanceof Error ? error.message : 'Unknown error searching knowledgebase'
        };
      }
    }
  }
};

/**
 * Convert server tools to Vertex AI function declarations
 * Full declarations with descriptions and schemas for native function calling
 */
export function getServerToolDeclarations() {
  return Object.entries(serverSideTools).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: tool.parameters
  }));
}

/**
 * Execute a server-side tool by name
 */
export async function executeServerTool(name: string, args: any, _context?: { clientTools?: any[] }) {
  const tool = serverSideTools[name as keyof typeof serverSideTools];
  if (!tool) {
    throw new Error(`Unknown server tool: ${name}`);
  }
  return await tool.execute(args);
}

/**
 * Check if a tool is server-side
 */
export function isServerSideTool(name: string): boolean {
  return name in serverSideTools;
}
