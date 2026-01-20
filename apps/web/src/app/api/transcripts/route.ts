import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy initialization to avoid build-time errors
let _supabaseAdmin: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (_supabaseAdmin) return _supabaseAdmin;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase URL or Service Role Key');
  }

  _supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
  return _supabaseAdmin;
}

function getInternalApiKey(): string {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) {
    throw new Error('INTERNAL_API_KEY is not set');
  }
  return key;
}

interface TranscriptionItem {
    id: string;
    type: string;
    role: string;
    content: string[];
    interrupted: boolean;
}

interface RawTranscriptRequest {
    session_id: string;
    user_id: string;
    starting_timestamp: string; // ISO format or any parseable date
    raw_content: string;
}

interface LegacyTranscriptRequest {
    session_id: string;
    user_id: string;
    items: TranscriptionItem[];
    lead_id?: string;
}

/**
 * Parse raw transcript text into structured messages
 */
interface TranscriptionItemWithTime extends TranscriptionItem {
  relativeTimeSeconds?: number;
}

function parseRawTranscript(rawContent: string, sessionId: string): TranscriptionItemWithTime[] {
  const lines = rawContent.split('\n').filter(line => line.trim().length > 0);
  const messages: TranscriptionItemWithTime[] = [];
  
  let messageCounter = 1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines
    if (!line) continue;
    
    // Check if line contains speaker + timestamp (format: "Speaker  3:40  ")
    const speakerTimeMatch = line.match(/^(.+?)\s+(\d{1,2}:\d{2})\s*$/);
    
    if (speakerTimeMatch) {
      const [, speaker, timeStr] = speakerTimeMatch;
      
      // Look for content on the next line(s)
      let content = '';
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        // Stop if we hit another speaker+timestamp line
        if (nextLine.match(/^(.+?)\s+(\d{1,2}:\d{2})\s*$/)) {
          break;
        }
        if (nextLine.length > 0) {
          content += (content ? ' ' : '') + nextLine;
        }
        j++;
      }
      
      // Convert relative time to seconds
      const [minutes, seconds] = timeStr.split(':').map(Number);
      const relativeTimeSeconds = (minutes * 60) + seconds;
      
      messages.push({
        id: `msg_${sessionId}_${messageCounter.toString().padStart(3, '0')}`,
        type: 'message',
        role: 'speaker',
        content: [`${speaker} (${timeStr}): ${content || '(no content)'}`],
        interrupted: false,
        relativeTimeSeconds: relativeTimeSeconds
      });
      
      messageCounter++;
      i = j - 1; // Skip the lines we already processed
    } else {
      // Handle lines that don't follow the speaker+timestamp format
      const speakerMatch = line.match(/^([^:]+):\s*(.*)$/);
      
      if (speakerMatch) {
        const [, speaker, content] = speakerMatch;
        messages.push({
          id: `msg_${sessionId}_${messageCounter.toString().padStart(3, '0')}`,
          type: 'message', 
          role: 'speaker',
          content: [`${speaker}: ${content}`],
          interrupted: false
          // No relativeTimeSeconds for lines without timestamps
        });
        messageCounter++;
      } else if (line.length > 0) {
        // Unstructured line - add as unknown speaker
        messages.push({
          id: `msg_${sessionId}_${messageCounter.toString().padStart(3, '0')}`,
          type: 'message',
          role: 'speaker', 
          content: [`Unknown: ${line}`],
          interrupted: false
          // No relativeTimeSeconds for lines without timestamps
        });
        messageCounter++;
      }
    }
  }
  
  return messages;
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (authHeader !== `Bearer ${getInternalApiKey()}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const body = await request.json();
    
    // Check if this is the new raw format or legacy format
    const isRawFormat = 'raw_content' in body;
    
    if (isRawFormat) {
      // Handle new raw transcript format
      const { session_id, user_id, starting_timestamp, raw_content }: RawTranscriptRequest = body;

      if (!session_id || !user_id || !starting_timestamp || !raw_content) {
        return NextResponse.json({ 
          error: 'session_id, user_id, starting_timestamp, and raw_content are required' 
        }, { status: 400 });
      }

      console.log(`📝 Processing raw transcript for session: ${session_id}, user: ${user_id}`);
      
      // Parse raw content into structured messages
      const parsedMessages = parseRawTranscript(raw_content, session_id);
      
      console.log(`🔍 Parsed ${parsedMessages.length} messages from raw transcript`);

      // Convert to database format using actual relative timestamps
      const recordsToInsert = parsedMessages.map((item, index) => {
        const messageTimestamp = new Date(starting_timestamp);
        
        if (item.relativeTimeSeconds !== undefined) {
          // Use actual relative timestamp from transcript
          messageTimestamp.setSeconds(messageTimestamp.getSeconds() + item.relativeTimeSeconds);
        } else {
          // Fallback to spacing for messages without timestamps
          messageTimestamp.setSeconds(messageTimestamp.getSeconds() + (index * 30));
        }
        
        return {
          session_id,
          user_id,
          lead_id: null, // Not using lead_id anymore
          item_id: item.id,
          type: item.type,
          role: item.role,
          content: item.content,
          interrupted: item.interrupted,
          created_at: messageTimestamp.toISOString()
        };
      });

      const { data, error } = await supabaseAdmin
        .from('agent_live_transcriptions')
        .insert(recordsToInsert);

      if (error) {
        console.error('Error inserting raw transcriptions:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ 
        message: 'Raw transcript ingested successfully', 
        data,
        parsed_messages: parsedMessages.length 
      }, { status: 201 });
      
    } else {
      // Handle legacy structured format
      const { session_id, user_id, items, lead_id }: LegacyTranscriptRequest = body;

      if (!session_id || !items || !Array.isArray(items)) {
        return NextResponse.json({ error: 'session_id and items array are required' }, { status: 400 });
      }

      const recordsToInsert = items.map((item: TranscriptionItem) => ({
        session_id,
        user_id,
        lead_id,
        item_id: item.id,
        type: item.type,
        role: item.role,
        content: item.content,
        interrupted: item.interrupted,
      }));

      const { data, error } = await supabaseAdmin
        .from('agent_live_transcriptions')
        .insert(recordsToInsert);

      if (error) {
        console.error('Error inserting transcriptions:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ message: 'Transcriptions ingested successfully', data }, { status: 201 });
    }

  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
} 