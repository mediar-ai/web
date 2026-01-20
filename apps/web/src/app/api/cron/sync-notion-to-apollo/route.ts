import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

interface NotionPage {
  id: string;
  last_edited_time: string;
  properties: {
    [key: string]: any;
  };
}

interface MeetingNote {
  notionPageId: string;
  title: string;
  attendeeEmail: string;
  content: string;
  lastEdited: string;
}

/**
 * Notion to Apollo Sync Cron Job
 *
 * Runs every 15 minutes to sync meeting notes from Notion to Apollo CRM
 *
 * Flow:
 * 1. Fetch recently updated pages from Notion database (meeting notes)
 * 2. Extract attendee email and meeting content
 * 3. Send email to Apollo's ingestion address
 * 4. Track synced pages in Supabase to avoid duplicates
 */
export async function POST(_request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const startTime = Date.now();
  const currentTime = new Date();

  console.log(`🔄 [${currentTime.toISOString()}] Notion → Apollo sync started`);

  try {
    // Check required env vars
    const requiredEnvVars = [
      'NOTION_API_KEY',
      'NOTION_DATABASE_ID',
      'APOLLO_INGEST_EMAIL',
      'RESEND_API_KEY'
    ];

    const missingEnvVars = requiredEnvVars.filter(
      varName => !process.env[varName]
    );

    if (missingEnvVars.length > 0) {
      console.error(`❌ Missing required env vars: ${missingEnvVars.join(', ')}`);
      return NextResponse.json(
        {
          success: false,
          error: `Missing env vars: ${missingEnvVars.join(', ')}`
        },
        { status: 500 }
      );
    }

    // 1. Get last sync time from database
    const { data: lastSync } = await supabase
      .from('notion_apollo_sync_state')
      .select('last_sync_time')
      .eq('sync_type', 'meeting_notes')
      .single();

    const lastSyncTime = lastSync?.last_sync_time
      ? new Date(lastSync.last_sync_time)
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours

    console.log(`📅 Syncing meetings since: ${lastSyncTime.toISOString()}`);

    // 2. Fetch updated pages from Notion
    const notionPages = await fetchNotionMeetingNotes(lastSyncTime);
    console.log(`📋 Found ${notionPages.length} meeting notes to sync`);

    if (notionPages.length === 0) {
      console.log('✅ No new meeting notes to sync');
      return NextResponse.json({
        success: true,
        message: 'No new meeting notes',
        syncedCount: 0,
        processingTimeMs: Date.now() - startTime,
      });
    }

    // 3. Process each meeting note
    const results = [];
    for (const meetingNote of notionPages) {
      try {
        console.log(`📝 Processing: ${meetingNote.title}`);

        // Send to Apollo via email
        await sendToApollo(meetingNote);

        // Track in database
        await supabase
          .from('notion_apollo_synced_pages')
          .upsert({
            notion_page_id: meetingNote.notionPageId,
            synced_at: currentTime.toISOString(),
            attendee_email: meetingNote.attendeeEmail,
            meeting_title: meetingNote.title,
          }, {
            onConflict: 'notion_page_id'
          });

        results.push({
          notionPageId: meetingNote.notionPageId,
          title: meetingNote.title,
          success: true,
        });

        console.log(`✅ Synced: ${meetingNote.title}`);
      } catch (error) {
        console.error(`❌ Failed to sync ${meetingNote.title}:`, error);
        results.push({
          notionPageId: meetingNote.notionPageId,
          title: meetingNote.title,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // 4. Update last sync time
    await supabase
      .from('notion_apollo_sync_state')
      .upsert({
        sync_type: 'meeting_notes',
        last_sync_time: currentTime.toISOString(),
      }, {
        onConflict: 'sync_type'
      });

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    const processingTime = Date.now() - startTime;

    console.log(`🏁 Sync completed in ${processingTime}ms`);
    console.log(`📊 Results: ${successCount} successful, ${failedCount} failed`);

    return NextResponse.json({
      success: true,
      timestamp: currentTime.toISOString(),
      processingTimeMs: processingTime,
      syncedCount: successCount,
      failedCount,
      results,
    });
  } catch (error) {
    console.error('❌ Sync error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: currentTime.toISOString(),
        processingTimeMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

/**
 * Fetch meeting notes from Notion that were updated after lastSyncTime
 */
async function fetchNotionMeetingNotes(lastSyncTime: Date): Promise<MeetingNote[]> {
  const notionApiKey = process.env.NOTION_API_KEY!;
  const databaseId = process.env.NOTION_DATABASE_ID!;

  // Query Notion database for updated pages
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: {
        timestamp: 'last_edited_time',
        last_edited_time: {
          after: lastSyncTime.toISOString(),
        },
      },
      sorts: [
        {
          timestamp: 'last_edited_time',
          direction: 'ascending',
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Notion API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const pages = data.results as NotionPage[];

  // Extract meeting notes with attendee emails
  const meetingNotes: MeetingNote[] = [];

  for (const page of pages) {
    try {
      // Extract title (usually from 'Name' or 'Title' property)
      const titleProp = page.properties.Name || page.properties.Title;
      const title = titleProp?.title?.[0]?.plain_text || 'Untitled Meeting';

      // Extract attendee email (customize property name)
      const emailProp = page.properties.Email || page.properties['Attendee Email'];
      const attendeeEmail = emailProp?.email || emailProp?.rich_text?.[0]?.plain_text;

      if (!attendeeEmail) {
        console.warn(`⚠️  Skipping page ${page.id}: no attendee email found`);
        continue;
      }

      // Fetch page content (blocks)
      const content = await fetchPageContent(page.id);

      meetingNotes.push({
        notionPageId: page.id,
        title,
        attendeeEmail,
        content,
        lastEdited: page.last_edited_time,
      });
    } catch (error) {
      console.error(`Error processing page ${page.id}:`, error);
    }
  }

  return meetingNotes;
}

/**
 * Fetch full page content from Notion
 */
async function fetchPageContent(pageId: string): Promise<string> {
  const notionApiKey = process.env.NOTION_API_KEY!;

  const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    headers: {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch page content: ${response.status}`);
  }

  const data = await response.json();
  const blocks = data.results;

  // Convert blocks to markdown-like text
  let content = '';
  for (const block of blocks) {
    const text = extractTextFromBlock(block);
    if (text) {
      content += text + '\n';
    }
  }

  return content;
}

/**
 * Extract text from Notion block
 */
function extractTextFromBlock(block: any): string {
  const type = block.type;

  if (!type || !block[type]) return '';

  const richText = block[type].rich_text || block[type].text;
  if (Array.isArray(richText)) {
    return richText.map((t: any) => t.plain_text).join('');
  }

  return '';
}

/**
 * Send meeting note to Apollo via email using Resend
 */
async function sendToApollo(meetingNote: MeetingNote): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY!;
  const apolloIngestEmail = process.env.APOLLO_INGEST_EMAIL!;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'meetings@mediar.ai';

  const emailBody = `
Meeting: ${meetingNote.title}
Date: ${new Date(meetingNote.lastEdited).toLocaleString()}
Attendee: ${meetingNote.attendeeEmail}

---

${meetingNote.content}

---

Auto-synced from Notion via Mediar
`.trim();

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: apolloIngestEmail,
      cc: meetingNote.attendeeEmail, // Apollo matches contact by CC email
      subject: `Meeting: ${meetingNote.title}`,
      text: emailBody,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send email: ${response.status} ${error}`);
  }

  console.log(`📧 Email sent to Apollo for ${meetingNote.attendeeEmail}`);
}

/**
 * GET handler for Vercel cron
 */
export async function GET(request: NextRequest) {
  return POST(request);
}
