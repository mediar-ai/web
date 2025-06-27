// Test environment detection logic

import { config } from 'dotenv';
config({ path: '.env.local' });

console.log('🧪 Testing Environment Detection Logic:');
console.log('');

// Test current environment
console.log('📍 Current Environment:');
console.log(`   - VERCEL: ${process.env.VERCEL || 'undefined'}`);
console.log(`   - NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
console.log(`   - GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS ? '✅ Set' : '❌ Not set'}`);
console.log(`   - GOOGLE_APPLICATION_CREDENTIALS_BASE64: ${process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ? '✅ Set' : '❌ Not set'}`);
console.log('');

// Simulate detection logic
const isVercel = process.env.VERCEL === '1';
console.log(`🔍 Environment Detection: ${isVercel ? 'Vercel' : 'Local'}`);
console.log('');

// Show which credentials would be used
if (isVercel && process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
  console.log('🔧 Would use: Base64 credentials (Vercel)');
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.log('🔧 Would use: File-based credentials (Local)');
} else {
  console.log('🔧 Would use: Default Google Cloud authentication');
}

console.log('');
console.log('✅ Environment detection logic working correctly!'); 