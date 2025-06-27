import { VertexAI } from '@google-cloud/vertexai';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function testVertexAI() {
  try {
    console.log('🔧 Testing Vertex AI setup...');
    console.log('Project:', process.env.GOOGLE_CLOUD_PROJECT);
    console.log('Credentials file:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
    
    // Initialize Vertex AI
    const vertex_ai = new VertexAI({
      project: process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0116095341',
      location: process.env.VERTEX_AI_LOCATION || 'us-central1',
    });

    console.log('✅ Vertex AI initialized successfully');

    // Test with a simple model
    console.log('🤖 Testing Gemini 2.0 Flash...');
    const model = vertex_ai.preview.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
    });

    console.log('✅ Model loaded successfully');

    // Test a simple generation
    console.log('💬 Testing content generation...');
    const result = await model.generateContent('Hello! Please respond with just "Vertex AI is working!"');
    const response = await result.response;
    const text = response.text();
    
    console.log('✅ Response received:', text);
    
    // Test with Gemini 2.5 Flash
    console.log('🤖 Testing Gemini 2.5 Flash...');
    const model25 = vertex_ai.preview.getGenerativeModel({
      model: 'gemini-2.5-flash-002',
    });
    
    const result25 = await model25.generateContent('What is 2+2? Answer briefly.');
    const response25 = await result25.response;
    const text25 = response25.text();
    
    console.log('✅ Gemini 2.5 Flash response:', text25);
    
    console.log('🎉 All tests passed! Vertex AI is working correctly.');
    
  } catch (error) {
    console.error('❌ Error testing Vertex AI:', error);
    console.error('Error details:', error.message);
    
    if (error.message.includes('PERMISSION_DENIED')) {
      console.log('💡 Fix: Make sure the service account has Vertex AI User role');
    }
    if (error.message.includes('API_KEY_INVALID')) {
      console.log('💡 Fix: Check your service account key file path');
    }
    if (error.message.includes('PROJECT_NOT_FOUND')) {
      console.log('💡 Fix: Verify the project ID is correct');
    }
  }
}

testVertexAI(); 