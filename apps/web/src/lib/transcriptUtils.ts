// Transcript utilities for workflow synthesis integration
// Handles formatting, filtering, and processing of conversation data

export interface TranscriptItem {
  id?: number;
  session_id: string;
  user_id?: string;
  lead_id?: string;
  item_id: string;
  type: string; // 'message', 'function_call', etc.
  role: string; // 'user', 'assistant', 'system'
  content: string[]; // Array of content strings
  interrupted?: boolean;
  created_at: string;
  updated_at?: string;
}

export interface TranscriptSummary {
  totalMessages: number;
  timeRange: {
    start: string;
    end: string;
  };
  participants: string[];
  sessionIds: string[];
  topics: string[];
  relevantExcerpts: string[];
}

/**
 * Format transcripts for inclusion in LLM prompts
 * @param transcripts Array of transcript items
 * @returns Formatted transcript string for prompt inclusion (no length limit)
 */
export function formatTranscriptsForPrompt(
  transcripts: TranscriptItem[]
): string {
  if (!transcripts || transcripts.length === 0) {
    return 'No conversation transcripts available for this time period.';
  }

  let formatted = '';

  // Sort by timestamp
  const sortedTranscripts = transcripts.sort((a, b) => 
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  for (const transcript of sortedTranscripts) {
    const timestamp = new Date(transcript.created_at).toLocaleTimeString();
    const content = Array.isArray(transcript.content) 
      ? transcript.content.join(' ') 
      : String(transcript.content);
    
    const entry = `[${timestamp}] ${transcript.role}: ${content}\n`;
    formatted += entry;
  }

  return formatted;
}

/**
 * Filter transcripts by time range
 * @param transcripts Array of transcript items
 * @param startTime Start time (ISO string)
 * @param endTime End time (ISO string)
 * @returns Filtered transcript items
 */
export function filterTranscriptsByTimeRange(
  transcripts: TranscriptItem[],
  startTime: string,
  endTime: string
): TranscriptItem[] {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  return transcripts.filter(transcript => {
    const transcriptTime = new Date(transcript.created_at).getTime();
    return transcriptTime >= start && transcriptTime <= end;
  });
}

/**
 * Extract key topics and themes from transcript content
 * @param transcripts Array of transcript items
 * @returns Array of identified topics/themes
 */
export function extractTranscriptTopics(transcripts: TranscriptItem[]): string[] {
  if (!transcripts || transcripts.length === 0) return [];

  const allContent = transcripts
    .map(t => Array.isArray(t.content) ? t.content.join(' ') : String(t.content))
    .join(' ')
    .toLowerCase();

  // Simple keyword extraction - can be enhanced with NLP
  const businessKeywords = [
    'insurance', 'policy', 'quote', 'premium', 'coverage', 'application',
    'client', 'customer', 'lead', 'prospect', 'agent', 'broker',
    'workflow', 'process', 'procedure', 'task', 'step', 'completion',
    'meeting', 'call', 'discussion', 'review', 'approval', 'submission'
  ];

  const topics = businessKeywords.filter(keyword => 
    allContent.includes(keyword)
  );

  // Add any frequently mentioned proper nouns (simple heuristic)
  const words = allContent.split(/\s+/);
  const capitalizedWords = words.filter(word => 
    word.length > 3 && 
    word[0] === word[0].toUpperCase() && 
    word.slice(1) === word.slice(1).toLowerCase()
  );
  
  const wordCounts = capitalizedWords.reduce((acc: Record<string, number>, word) => {
    acc[word] = (acc[word] || 0) + 1;
    return acc;
  }, {});

  const frequentTerms = Object.entries(wordCounts)
    .filter(([, count]) => count >= 2)
    .map(([word]) => word);

  return [...new Set([...topics, ...frequentTerms])].slice(0, 10);
}

/**
 * Create a summary of transcript data for context
 * @param transcripts Array of transcript items
 * @returns Transcript summary object
 */
export function createTranscriptSummary(transcripts: TranscriptItem[]): TranscriptSummary {
  if (!transcripts || transcripts.length === 0) {
    return {
      totalMessages: 0,
      timeRange: { start: '', end: '' },
      participants: [],
      sessionIds: [],
      topics: [],
      relevantExcerpts: []
    };
  }

  const sortedTranscripts = transcripts.sort((a, b) => 
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const participants = [...new Set(transcripts.map(t => t.role))];
  const sessionIds = [...new Set(transcripts.map(t => t.session_id))];
  const topics = extractTranscriptTopics(transcripts);

  // Extract relevant excerpts (longer messages that might contain key info)
  const relevantExcerpts = transcripts
    .filter(t => {
      const content = Array.isArray(t.content) ? t.content.join(' ') : String(t.content);
      return content.length > 50 && content.length < 300; // Good size for excerpts
    })
    .slice(0, 5) // Limit to 5 excerpts
    .map(t => Array.isArray(t.content) ? t.content.join(' ') : String(t.content));

  return {
    totalMessages: transcripts.length,
    timeRange: {
      start: sortedTranscripts[0].created_at,
      end: sortedTranscripts[sortedTranscripts.length - 1].created_at
    },
    participants,
    sessionIds,
    topics,
    relevantExcerpts
  };
}

/**
 * Correlate transcripts with workflow analysis timestamps
 * @param transcripts Array of transcript items
 * @param analysisTimestamp Analysis timestamp to correlate with
 * @param windowMinutes Time window in minutes to look for related transcripts
 * @returns Transcripts that occurred near the analysis timestamp
 */
export function correlateTranscriptsWithAnalysis(
  transcripts: TranscriptItem[],
  analysisTimestamp: string,
  windowMinutes: number = 30
): TranscriptItem[] {
  const analysisTime = new Date(analysisTimestamp).getTime();
  const windowMs = windowMinutes * 60 * 1000;

  return transcripts.filter(transcript => {
    const transcriptTime = new Date(transcript.created_at).getTime();
    const timeDiff = Math.abs(transcriptTime - analysisTime);
    return timeDiff <= windowMs;
  });
}

/**
 * Format user instructions for prompt inclusion
 * @param instructions User-provided additional instructions
 * @returns Formatted instructions string
 */
export function formatUserInstructions(instructions?: string): string {
  if (!instructions || instructions.trim().length === 0) {
    console.log('📋 No user instructions provided for workflow synthesis');
    return 'No additional user instructions provided.';
  }

  console.log('[SUCCESS] User instructions detected for workflow synthesis:', instructions.substring(0, 100) + (instructions.length > 100 ? '...' : ''));
  return `User Instructions: ${instructions.trim()}`;
}

/**
 * Combine transcript data with user instructions for comprehensive context
 * @param transcripts Array of transcript items
 * @param userInstructions Optional user instructions
 * @returns Combined context string (no length limit)
 */
export function buildComprehensiveContext(
  transcripts: TranscriptItem[],
  userInstructions?: string
): string {
  console.log('[FIX] Building comprehensive context for workflow synthesis:');
  console.log(`[STATS] Transcripts: ${transcripts.length} messages`);
  console.log(`📝 Instructions: ${userInstructions ? 'provided' : 'none'}`);
  console.log('📏 No transcript length limits applied');
  
  const transcriptContext = formatTranscriptsForPrompt(transcripts);
  const instructionsContext = formatUserInstructions(userInstructions);
  const summary = createTranscriptSummary(transcripts);

  let context = '';

  // Add transcript summary if available
  if (summary.totalMessages > 0) {
    context += `CONVERSATION SUMMARY:\n`;
    context += `- Total messages: ${summary.totalMessages}\n`;
    context += `- Time range: ${new Date(summary.timeRange.start).toLocaleString()} to ${new Date(summary.timeRange.end).toLocaleString()}\n`;
    context += `- Participants: ${summary.participants.join(', ')}\n`;
    context += `- Key topics: ${summary.topics.join(', ')}\n\n`;
  }

  // Add full transcript content
  context += `CONVERSATION TRANSCRIPTS:\n${transcriptContext}\n\n`;

  // Add user instructions
  context += `ADDITIONAL CONTEXT:\n${instructionsContext}\n`;

  return context;
} 