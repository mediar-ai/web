import { defineConfig } from 'tsup';

export default defineConfig([
  // Library builds (no shebang)
  {
    entry: {
      index: 'src/index.ts',
      'azure/index': 'src/azure/index.ts',
      'telemetry/index': 'src/telemetry/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    shims: true,
  },
  // CLI build (with shebang)
  {
    entry: {
      'cli/index': 'src/cli/index.ts',
    },
    format: ['cjs'],
    dts: false,
    splitting: false,
    sourcemap: true,
    shims: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
