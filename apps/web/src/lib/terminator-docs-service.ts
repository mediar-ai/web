/**
 * Shared service for loading and caching Terminator documentation
 * Used by both execution-qa and main AI routes
 */

// Simple in-memory cache for Terminator documentation
let cachedDocs: {
  content: string | null;
  timestamp: number;
} | null = null;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

/**
 * Load Terminator documentation from GitHub
 * Uses caching to avoid repeated API calls
 */
export async function loadTerminatorDocs(): Promise<string | null> {
  // Check cache first
  if (cachedDocs && (Date.now() - cachedDocs.timestamp < CACHE_TTL_MS)) {
    console.log('[TERMINATOR-DOCS] Using cached documentation');
    return cachedDocs.content;
  }

  console.log('[TERMINATOR-DOCS] Loading documentation from GitHub...');

  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/mediar-ai/terminator/main/terminator-mcp-agent/src/prompt.rs'
    );

    if (response.ok) {
      const content = await response.text();

      // Update cache
      cachedDocs = {
        content,
        timestamp: Date.now()
      };

      console.log('[TERMINATOR-DOCS] Documentation loaded successfully');
      return content;
    }

    console.error('[TERMINATOR-DOCS] Failed to load documentation:', response.status);
    return null;
  } catch (error) {
    console.error('[TERMINATOR-DOCS] Error loading documentation:', error);
    return null;
  }
}

/**
 * Search Terminator documentation for specific patterns or topics
 * Extracted from execution-qa route for reuse
 */
export function searchTerminatorDocs(
  docs: string,
  pattern: string,
  limit: number = 5
): Array<{ section: string; content: string; lineNumber: number }> {
  const searchPattern = pattern.toLowerCase();
  const lines = docs.split('\n');
  const matches: { section: string; content: string; lineNumber: number }[] = [];

  let currentSection = 'Introduction';
  let sectionContent: string[] = [];
  let sectionStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section headers (markdown ## or ###)
    if (line.startsWith('##')) {
      // Save previous section if it matches
      if (sectionContent.join('\n').toLowerCase().includes(searchPattern)) {
        matches.push({
          section: currentSection,
          content: sectionContent.join('\n'),
          lineNumber: sectionStartLine
        });
        if (matches.length >= limit) break;
      }

      // Start new section
      currentSection = line.replace(/^#+\s*/, '');
      sectionContent = [line];
      sectionStartLine = i + 1;
    } else {
      sectionContent.push(line);
    }
  }

  // Check last section
  if (matches.length < limit && sectionContent.join('\n').toLowerCase().includes(searchPattern)) {
    matches.push({
      section: currentSection,
      content: sectionContent.join('\n'),
      lineNumber: sectionStartLine
    });
  }

  return matches;
}

/**
 * Clear the documentation cache (useful for testing or manual refresh)
 */
export function clearDocsCache(): void {
  cachedDocs = null;
  console.log('[TERMINATOR-DOCS] Cache cleared');
}