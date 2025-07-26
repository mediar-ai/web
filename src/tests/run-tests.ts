#!/usr/bin/env tsx

/**
 * Test Runner Script
 *
 * Usage:
 *   npm run test:mcp
 *   npx tsx src/tests/run-tests.ts
 *   node -r tsx/register src/tests/run-tests.ts
 */

import { runMCPIntegrationTests } from './ai-mcp-integration.test';
import { TestLogger } from './utils';

async function main() {
  console.log('🧪 Test Suite Runner');
  console.log('='.repeat(50));

  const args = process.argv.slice(2);

  // Parse command line arguments
  const config: any = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    const value = args[i + 1];

    if (key && value) {
      switch (key) {
        case 'url':
          config.apiBaseUrl = value;
          break;
        case 'password':
          config.apiPassword = value;
          break;
        case 'timeout':
          config.timeout = parseInt(value, 10);
          break;
      }
    }
  }

  TestLogger.info('Starting test suite with config', config);

  try {
    const success = await runMCPIntegrationTests(config);

    console.log('\n' + '='.repeat(50));
    console.log(success ? '🎉 Test suite PASSED' : '❌ Test suite FAILED');
    console.log('='.repeat(50));

    process.exit(success ? 0 : 1);
  } catch (error) {
    TestLogger.error('Test suite crashed', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
