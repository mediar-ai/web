/**
 * Server-side knowledge tools that execute directly on the backend
 * No round-trip to client needed - direct database access
 */

import { createClient } from '@supabase/supabase-js';
import { generateQueryEmbedding } from '@/lib/vertex-embeddings';
import { Type } from '@/app/api/ai/types/vertex';

// Alias for backward compatibility
const SchemaType = Type;
import { serverSideWorkflowTools } from './workflow-editing-tools';
import { serverSideDevLogTools } from './dev-log-tools';
// NOTE: terminator-api-service functions are inlined below to avoid Turbopack chunking issues with fs/path

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
  },

  get_terminator_api_docs: {
    description: 'Get the complete Terminator API documentation from TypeScript declarations. Returns the full .d.ts file with all type definitions, interfaces, and JSDoc comments. Use this when you need to see the complete API or browse available tools.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        includeMetadata: {
          type: SchemaType.BOOLEAN,
          description: 'Include file metadata (path, size, version)',
          default: false
        }
      },
      required: []
    },
    execute: async (params: {
      includeMetadata?: boolean;
    }) => {
      try {
        console.log('[SERVER-TERMINATOR-API] Getting full API docs');
        
        // Dynamic imports - bundler ignores these, executed at runtime
        const { readFileSync, statSync } = await import('fs');
        const { join, dirname } = await import('path');
        
        // Use direct path - avoid require.resolve() which triggers webpack bundling
        const dtsPath = join(process.cwd(), 'node_modules/@mediar-ai/terminator/index.d.ts');
        const docs = readFileSync(dtsPath, 'utf-8');
        console.log(`[TERMINATOR-API] Read ${docs.length} chars from ${dtsPath}`);
        
        const result: any = {
          action: 'docs_retrieved',
          docs,
          lineCount: docs.split('\n').length,
          charCount: docs.length
        };
        
        if (params.includeMetadata) {
          const stats = statSync(dtsPath);
          let version: string | undefined;
          try {
            const packageJsonPath = join(dirname(dtsPath), 'package.json');
            const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
            version = packageJson.version;
          } catch {}
          
          result.metadata = {
            path: dtsPath,
            size: stats.size,
            lineCount: docs.split('\n').length,
            version
          };
        }
        
        return result;
      } catch (error) {
        console.error('[SERVER-TERMINATOR-API] Error:', error);
        return {
          action: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error reading API docs'
        };
      }
    }
  },

  search_terminator_api: {
    description: 'Search Terminator TypeScript API documentation with surrounding context. Returns matched lines with configurable context window. Use this when searching for specific tools, parameters, or type definitions.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        pattern: {
          type: SchemaType.STRING,
          description: 'Search pattern (e.g., "click", "ClickElementParams", "browser", "type_text")'
        },
        contextLines: {
          type: SchemaType.NUMBER,
          description: 'Number of lines to show before and after each match (default: 10)',
          default: 10
        },
        maxMatches: {
          type: SchemaType.NUMBER,
          description: 'Maximum number of matches to return (default: 10)',
          default: 10
        }
      },
      required: ['pattern']
    },
    execute: async (params: {
      pattern: string;
      contextLines?: number;
      maxMatches?: number;
    }) => {
      try {
        console.log('[SERVER-TERMINATOR-API] Searching for:', params.pattern);
        
        // Dynamic imports - bundler ignores these, executed at runtime
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        
        // Use direct path - avoid require.resolve() which triggers webpack bundling
        const dtsPath = join(process.cwd(), 'node_modules/@mediar-ai/terminator/index.d.ts');
        const content = readFileSync(dtsPath, 'utf-8');
        
        // Search logic
        const lines = content.split('\n');
        const matches: Array<{ lineNumber: number; matchedLine: string; context: string; section?: string }> = [];
        const searchPattern = params.pattern.toLowerCase();
        const contextLines = params.contextLines || 10;
        const maxMatches = params.maxMatches || 10;
        
        for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
          const line = lines[i];
          
          if (line.toLowerCase().includes(searchPattern)) {
            const startLine = Math.max(0, i - contextLines);
            const endLine = Math.min(lines.length - 1, i + contextLines);
            const contextLines_arr = lines.slice(startLine, endLine + 1);
            const context = contextLines_arr.join('\n');
            
            // Find section name
            let section: string | undefined;
            for (let j = i; j >= Math.max(0, i - 50); j--) {
              const l = lines[j].trim();
              const interfaceMatch = l.match(/(?:export\s+)?interface\s+(\w+)/);
              if (interfaceMatch) {
                section = interfaceMatch[1];
                break;
              }
              const typeMatch = l.match(/(?:export\s+)?type\s+(\w+)/);
              if (typeMatch) {
                section = typeMatch[1];
                break;
              }
              const functionMatch = l.match(/(?:export\s+)?function\s+(\w+)/);
              if (functionMatch) {
                section = functionMatch[1];
                break;
              }
            }
            
            matches.push({
              lineNumber: i + 1,
              matchedLine: line.trim(),
              context,
              section
            });
          }
        }
        
        console.log(`[TERMINATOR-API] Found ${matches.length} matches for "${params.pattern}"`);
        
        if (matches.length === 0) {
          return {
            action: 'search_completed',
            query: params.pattern,
            found: false,
            message: `No matches found for "${params.pattern}". Try searching for tool names like "click", "type", "browser", or parameter interfaces like "ClickElementParams".`
          };
        }
        
        return {
          action: 'search_completed',
          query: params.pattern,
          found: true,
          matchCount: matches.length,
          matches
        };
      } catch (error) {
        console.error('[SERVER-TERMINATOR-API] Error:', error);
        return {
          action: 'search_failed',
          query: params.pattern,
          error: error instanceof Error ? error.message : 'Unknown error searching API docs'
        };
      }
    }
  },

  get_tool_details: {
    description: 'Get detailed parameter information for specific tools. Use this when you need to call a tool but need to see its full parameter schema first.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        tool_names: {
          type: SchemaType.ARRAY,
          description: 'Array of tool names to get details for',
          items: {
            type: SchemaType.STRING
          }
        }
      },
      required: ['tool_names']
    },
    execute: async (params: {
      tool_names: string[];
    }, context?: {
      clientTools?: any[]; // Original client tools with full schemas
    }) => {
      try {
        console.log('[SERVER-GET-TOOL-DETAILS] Getting details for tools:', params.tool_names);

        const toolDetails: any[] = [];

        for (const name of params.tool_names) {
          // 1. Check knowledge tools (serverSideTools in this file)
          if (serverSideTools[name as keyof typeof serverSideTools]) {
            const tool = serverSideTools[name as keyof typeof serverSideTools];
            toolDetails.push({
              name,
              description: tool.description,
              parameters: tool.parameters
            });
          }
          // 2. Check workflow editing tools
          else if (serverSideWorkflowTools[name as keyof typeof serverSideWorkflowTools]) {
            const tool = serverSideWorkflowTools[name as keyof typeof serverSideWorkflowTools];
            toolDetails.push({
              name,
              description: tool.description,
              parameters: tool.parameters
            });
          }
          // 3. Check dev log tools
          else if (serverSideDevLogTools[name as keyof typeof serverSideDevLogTools]) {
            const tool = serverSideDevLogTools[name as keyof typeof serverSideDevLogTools];
            toolDetails.push({
              name,
              description: tool.description,
              parameters: tool.parameters
            });
          }
          // 4. Check client tools (MCP/desktop tools)
          else if (context?.clientTools) {
            const clientTool = context.clientTools.find(t => t.name === name);
            if (clientTool) {
              toolDetails.push({
                name: clientTool.name,
                description: clientTool.description,
                parameters: clientTool.parameters
              });
            }
          }
        }

        if (toolDetails.length === 0) {
          return {
            action: 'no_tools_found',
            requested: params.tool_names,
            message: 'None of the requested tools were found.'
          };
        }

        console.log(`[SERVER-GET-TOOL-DETAILS] Returning details for ${toolDetails.length} tools`);

        return {
          action: 'tool_details_retrieved',
          requested_count: params.tool_names.length,
          found_count: toolDetails.length,
          tools: toolDetails
        };
      } catch (error) {
        console.error('[SERVER-GET-TOOL-DETAILS] Error:', error);
        return {
          action: 'error',
          error: error instanceof Error ? error.message : 'Failed to retrieve tool details'
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
export async function executeServerTool(name: string, args: any, context?: { clientTools?: any[] }) {
  const tool = serverSideTools[name as keyof typeof serverSideTools];
  if (!tool) {
    throw new Error(`Unknown server tool: ${name}`);
  }
  return await tool.execute(args, context);
}

/**
 * Check if a tool is server-side
 */
export function isServerSideTool(name: string): boolean {
  return name in serverSideTools;
}