import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const { userId, model, startDate, endDate, userInstructions } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'Missing required "userId" parameter' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Missing Supabase environment variables');
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Create a new session to track this orchestration
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('synthesis_sessions')
      .insert({
        user_id: userId,
        orchestration_status: 'Starting...',
        orchestration_progress: 0,
      })
      .select()
      .single();

    if (sessionError) throw new Error(`Failed to create synthesis session: ${sessionError.message}`);

    // Launch the Modal job using Python script
    try {
      const scriptPath = path.join(process.cwd(), 'local-scripts', 'trigger_full_synthesis.py');
      
      const pythonProcess = spawn('python3', [
        scriptPath,
        userId,
        model,
        startDate,
        endDate,
        userInstructions || '',
        session.id
      ]);

      let output = '';
      let errorOutput = '';

      pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      const result = await new Promise((resolve, reject) => {
        pythonProcess.on('close', (code) => {
          if (code === 0) {
            // Parse the JSON response from the last line of output
            const lines = output.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            try {
              const response = JSON.parse(lastLine);
              resolve(response);
            } catch {
              resolve({ success: true, session_id: session.id });
            }
          } else {
            reject(new Error(`Python script failed with code ${code}: ${errorOutput}`));
          }
        });
      });

      console.log(`✅ Modal job launched for session ${session.id}`);
      return NextResponse.json({ success: true, sessionId: session.id, modalResult: result });
      
    } catch (modalError) {
      console.error(`❌ Failed to launch Modal job: ${modalError}`);
      // Update session with error
      await supabaseAdmin
        .from('synthesis_sessions')
        .update({
          orchestration_status: `Error: Failed to launch background job`,
          orchestration_progress: -1,
        })
        .eq('id', session.id);
        
      throw new Error(`Failed to launch background processing job: ${modalError}`);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Failed to trigger full synthesis', details: errorMessage }, { status: 500 });
  }
} 