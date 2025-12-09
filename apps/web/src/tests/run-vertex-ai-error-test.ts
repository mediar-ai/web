#!/usr/bin/env ts-node

import { runVertexAIErrorTest } from './vertex-ai-error.test';

async function main() {
  console.log('Ì∫Ä Running VertexAI Error Reproduction Test');
  console.log('This test attempts to reproduce the specific VertexAI error:');
  console.log('"Please ensure that the number of function response parts is equal to the number of function call parts"');
  console.log('');
  
  try {
    await runVertexAIErrorTest();
  } catch (error) {
    console.error('‚ùå Test runner failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
