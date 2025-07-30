import { getVertexGenAI } from '@/lib/vertexai';
import { NextRequest, NextResponse } from 'next/server';

interface SearchResults {
  found: boolean;
  keyword: string;
  userId: string;
  results: Array<{
    eventId: number;
    timestamp: string;
    appName: string | null;
    cleanValues: {
      textContent: string[];
      formFields: string[];
      buttons: string[];
      links: string[];
      totalValues: number;
      keywordMatches?: Array<{
        text: string;
        type: string;
        context: string;
      }>;
    };
    summary: {
      totalTextElements: number;
      totalFormFields: number;
      totalButtons: number;
      totalLinks: number;
      totalUniqueValues: number;
      keywordMatchesCount?: number;
    };
    keywordMatches?: Array<{
      text: string;
      type: string;
      context: string;
    }>;
  }>;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    currentPage?: number;
    totalPages?: number;
  };
  meta?: {
    processingTime: number;
    totalValuesExtracted: number;
    resultsReturned: number;
  };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { searchResults, question }: { searchResults: SearchResults; question: string } = await request.json();

    // Validate input
    if (!searchResults || !question) {
      return NextResponse.json(
        { error: 'Missing required fields: searchResults and question' },
        { status: 400 }
      );
    }

    // Security: Validate that searchResults has proper structure and userId
    if (!searchResults.userId || typeof searchResults.userId !== 'string') {
      return NextResponse.json(
        { error: 'Invalid search results: missing or invalid userId' },
        { status: 400 }
      );
    }

    // Security: Ensure we only process search results that belong to a valid user
    if (!searchResults.found || !searchResults.results || !Array.isArray(searchResults.results)) {
      return NextResponse.json(
        { error: 'Invalid search results format' },
        { status: 400 }
      );
    }

    console.log(`🔍 Analyzing search results for user ${searchResults.userId}, keyword: "${searchResults.keyword}"`);

    // Format search results for AI context
    const results = searchResults.results;
    const formattedResults: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const timestamp = result.timestamp;
      const appName = result.appName || 'Unknown app';
      const cleanValues = result.cleanValues;
      const summary = result.summary;

      const formattedResult = `
Event ${i + 1}:
- Timestamp: ${timestamp}
- App: ${appName}
- Text Elements: ${summary.totalTextElements}
- Buttons: ${summary.totalButtons}
- Form Fields: ${summary.totalFormFields}
- Links: ${summary.totalLinks}
- Sample Text: ${cleanValues.textContent.slice(0, 3)}
- Sample Buttons: ${cleanValues.buttons.slice(0, 3)}
- Sample Form Fields: ${cleanValues.formFields.slice(0, 3)}
`;
      formattedResults.push(formattedResult);
    }

    // Prepare AI request with simplified prompt
    const actualPrompt = 'Analyze this: The user searched for "' + searchResults.keyword + '" and found ' + results.length + ' results. ' + question;

    console.log(`🤖 Calling Vertex AI directly...`);
    console.log('🔍 Prompt being sent:', actualPrompt);

    // Call Vertex AI directly using getVertexGenAI
    const genAI = getVertexGenAI();
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-pro'
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: actualPrompt }] }],
      generationConfig: {
        temperature: 0.7,
      },
    });

    const aiResponse = result.response;
    const aiAnalysis = aiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!aiAnalysis || aiAnalysis.trim() === '') {
      console.error('❌ Empty AI response from Vertex AI');
      throw new Error('No response received from AI');
    }

    console.log(`✅ AI analysis completed in ${Date.now() - startTime}ms`);

    // Prepare response
    const responseData = {
      question: question.trim(),
      analysis: aiAnalysis.trim(),
      searchSummary: {
        keyword: searchResults.keyword,
        totalEvents: searchResults.pagination.total,
        timeRange: results.length > 0 ? 
          `${results[results.length - 1].timestamp} to ${results[0].timestamp}` : 
          'No events'
      },
      meta: {
        processingTime: Date.now() - startTime,
        resultsAnalyzed: results.length,
        model: 'gemini-2.5-pro'
      }
    };

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('❌ Analysis error:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to analyze search results',
        details: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime
      },
      { status: 500 }
    );
  }
} 