import { getVertexGenAI } from './src/lib/vertexai.js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function testCursorRuleModels() {
  try {
    console.log('🔧 Testing Vertex AI with cursor rule models...');
    console.log('Project:', process.env.GOOGLE_CLOUD_PROJECT);
    console.log('Credentials file:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
    
    // Initialize Vertex AI with Google AI Studio interface
    const genAI = getVertexGenAI();

    console.log('✅ Vertex AI initialized successfully');

    // Test with default model per cursor rule: gemini-2.5-pro-preview-06-05
    console.log('🤖 Testing default model per cursor rule: gemini-2.5-pro-preview-06-05...');
    const defaultModel = genAI.getGenerativeModel({ model: 'gemini-2.5-pro-preview-06-05' });

    console.log('💬 Testing content generation with default model...');
    const result1 = await defaultModel.generateContent('Hello! Please respond with just "Default cursor rule model working!"');
    const text1 = result1.response.text();
    
    console.log('✅ Default model response:', text1);
    
    // Test with alternative model per cursor rule: gemini-2.5-flash-preview-05-20
    console.log('🤖 Testing alternative model per cursor rule: gemini-2.5-flash-preview-05-20...');
    const altModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-05-20' });
    
    const result2 = await altModel.generateContent('What is 2+2? Answer briefly.');
    const text2 = result2.response.text();
    
    console.log('✅ Alternative model response:', text2);
    
    console.log('🎉 All cursor rule models working correctly with Vertex AI!');
    console.log('📝 Note: Models are mapped to available Vertex AI equivalents');
    
  } catch (error) {
    console.error('❌ Error testing cursor rule models:', error);
    console.error('Error details:', error.message);
    
    if (error.message.includes('PERMISSION_DENIED')) {
      console.log('💡 Fix: Make sure the service account has Vertex AI User role');
    }
    if (error.message.includes('not found')) {
      console.log('💡 Fix: The model might not be available in this region');
    }
  }
}

testCursorRuleModels(); 