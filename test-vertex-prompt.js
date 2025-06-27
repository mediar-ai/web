const { VertexAI } = require('@google-cloud/vertexai');

// Initialize Vertex AI
const vertex_ai = new VertexAI({
  project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
  location: process.env.VERTEX_AI_LOCATION || 'us-central1',
});

async function testVertexAI() {
  try {
    console.log('🧪 Testing Vertex AI with real prompt...');
    console.log('📍 Project:', process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022');
    console.log('📍 Location:', process.env.VERTEX_AI_LOCATION || 'us-central1');
    console.log('');

    // Test with gemini-2.5-flash (standard Vertex AI name)
    const model = vertex_ai.preview.getGenerativeModel({
      model: 'gemini-2.5-flash',
    });

    console.log('✅ Model instance created successfully');
    console.log('🚀 Sending test prompt...');
    console.log('');

    const prompt = `You are helping analyze user workflow data. Given this context:

User is working on a web development project and just opened VS Code, then navigated to a React component file called "Button.tsx".

Please provide a brief analysis in JSON format with these fields:
- workflow_step: A concise name for this step
- description: What's happening in 1-2 sentences
- business_logic: Any inferred business rules or patterns

Keep it concise and practical.`;

    const result = await model.generateContent(prompt);
    const response = result.response.candidates[0].content.parts[0].text;
    
    console.log('🎉 Response received:');
    console.log('─'.repeat(50));
    console.log(response);
    console.log('─'.repeat(50));
    console.log('');
    
    // Test token usage if available
    if (result.response.usageMetadata) {
      console.log('📊 Usage Metadata:');
      console.log('   Input tokens:', result.response.usageMetadata.promptTokenCount);
      console.log('   Output tokens:', result.response.usageMetadata.candidatesTokenCount);
      console.log('   Total tokens:', result.response.usageMetadata.totalTokenCount);
    }
    
    console.log('✅ Vertex AI gemini-2.5-flash is working correctly!');
    
  } catch (error) {
    console.error('❌ Error testing Vertex AI:', error);
    console.error('');
    console.error('💡 Make sure you have:');
    console.error('   1. Set GOOGLE_CLOUD_PROJECT in .env.local');
    console.error('   2. Set GOOGLE_APPLICATION_CREDENTIALS in .env.local');
    console.error('   3. Service account has Vertex AI User role');
  }
}

testVertexAI(); 