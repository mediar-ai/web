import { NextResponse } from 'next/server';
import { 
    generateMultiActivityEventAnalysis, 
    generateUiDiffAnalysis, 
    generateMainAnalysis
} from '@/lib/analysis';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
        image, 
        image1_dataUrl, 
        image2_dataUrl, 
        prompt, 
        analysisType,
        activitiesSummary
    } = body;

    switch (analysisType) {
      case 'multi_activity_event':
        if (!activitiesSummary) return NextResponse.json({ error: 'No activities provided for analysis.' }, { status: 400 });
        const eventAnalysis = await generateMultiActivityEventAnalysis(activitiesSummary, prompt);
        return NextResponse.json({ analysis: eventAnalysis });
      
      case 'ui_diff':
        if (!image1_dataUrl || !image2_dataUrl) return NextResponse.json({ error: 'Missing images for UI Diff.' }, { status: 400 });
        const diffAnalysis = await generateUiDiffAnalysis(image1_dataUrl, image2_dataUrl, prompt);
        return NextResponse.json({ analysis: diffAnalysis });

      case 'workflow':
        if (!image) return NextResponse.json({ error: 'No image provided for workflow analysis.' }, { status: 400 });
        const workflowAnalysis = await generateMainAnalysis(image, '', prompt); // Empty UI tree since we only have image
        return NextResponse.json({ analysis: workflowAnalysis });
        
      case 'initial_frame_dump':
        if (!image) return NextResponse.json({ error: 'No image provided for frame dump.' }, { status: 400 });
        // Use the main analysis function to extract text content from the image
        const dumpAnalysis = await generateMainAnalysis(image, '', prompt || 'Extract all visible text and UI elements from this image in maximum detail. Describe layout and objects.') as {
          step_title?: string;
          step_summary?: string;
          events_that_happened?: string;
          how_content_changed?: string;
          results_if_any?: string;
        };
        // Convert to a text stream for backwards compatibility
        const textContent = `Step: ${dumpAnalysis.step_title || 'Unknown'}\nSummary: ${dumpAnalysis.step_summary || 'No summary'}\nUI Elements: ${dumpAnalysis.events_that_happened || 'No events detected'}\nContent Changes: ${dumpAnalysis.how_content_changed || 'No changes detected'}\nResults: ${dumpAnalysis.results_if_any || 'No results'}`;
        return new NextResponse(textContent, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

      default:
        return NextResponse.json({ error: 'Invalid analysis type.' }, { status: 400 });
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    // Check if it's a Google AI error and customize the message to be cleaner
    if (errorMessage.includes('GoogleGenerativeAI Error')) {
      const specificError = errorMessage.split('Base64 decoding failed')[0] || 'AI analysis failed';
      const cleanMessage = `[API/capture] ${specificError.trim()}`;
      console.error(cleanMessage);
      return NextResponse.json({ error: 'Failed to process capture request.', details: cleanMessage }, { status: 500 });
    } else {
      console.error(`[API/capture] Error: ${errorMessage}`);
      return NextResponse.json({ error: 'Failed to process capture request.', details: errorMessage }, { status: 500 });
    }
  }
} 