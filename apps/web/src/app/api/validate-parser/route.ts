import { getVertexGenAI } from '@/lib/vertexai';
import { NextRequest, NextResponse } from 'next/server';

const VALIDATION_PROMPT = `You are a code validator for workflow output parsers. Analyze the JavaScript code and determine if it follows the standardized output format.

The standardized format requires the parser to return an object with these EXACT fields:
- success: boolean (indicates business logic success, not just technical execution)
- data: any (the extracted/processed data, null or empty on failure)
- message: string (human-readable success/failure message)
- error: string | null (error details if failed, null otherwise)
- validation: object (object containing validation checks that were performed)

IMPORTANT:
- The parser MUST return an object with ALL 5 fields
- Field names must be exactly as specified (case-sensitive)
- The 'success' field should indicate business logic success (e.g., "found quotes", "form submitted"), not just technical success
- The 'validation' object should contain meaningful checks that were performed

Analyze this parser code:

\`\`\`javascript
{PARSER_CODE}
\`\`\`

Respond with a JSON object:
{
  "hasStandardFormat": boolean,
  "isValid": boolean, 
  "errors": string[], // Critical issues that break the parser
  "warnings": string[], // Suggestions for improvement
  "explanation": string // Brief explanation of the analysis
}`;

export async function POST(request: NextRequest) {
  try {
    const { parserCode } = await request.json();

    if (!parserCode) {
      return NextResponse.json(
        {
          isValid: false,
          errors: ['No parser code provided'],
          warnings: [],
          hasStandardFormat: false,
        },
        { status: 400 }
      );
    }

    // Use Vertex AI Gemini Flash for fast, intelligent validation
    const genAI = getVertexGenAI();
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash', // Using 2.5 flash for better performance
    });

    const prompt = VALIDATION_PROMPT.replace('{PARSER_CODE}', parserCode);

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1, // Low temperature for consistent validation
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
      },
    });

    const response = result.response;
    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    try {
      const validation = JSON.parse(text);

      // Ensure response has required fields
      return NextResponse.json({
        isValid: validation.isValid ?? true,
        errors: validation.errors || [],
        warnings: validation.warnings || [],
        hasStandardFormat: validation.hasStandardFormat ?? false,
        explanation: validation.explanation,
      });
    } catch {
      console.error('Failed to parse Gemini response:', text);
      // Fallback if JSON parsing fails
      return NextResponse.json({
        isValid: true,
        errors: [],
        warnings: ['Could not validate parser format with AI'],
        hasStandardFormat: false,
      });
    }
  } catch (error) {
    console.error('Parser validation error:', error);

    // Don't block workflow creation on validation errors
    return NextResponse.json({
      isValid: true,
      errors: [],
      warnings: ['Validation service temporarily unavailable'],
      hasStandardFormat: false,
    });
  }
}
