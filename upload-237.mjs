import { WorkflowFileManager } from './src/lib/workflow-file-manager.js';
import { promises as fs } from 'fs';
import path from 'path';

const wfId = 237;
const files = [];

async function collect(dir, base) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !['node_modules','dist','.git'].includes(e.name)) {
      await collect(full, base);
    } else if (/\.(ts|js|json)$/.test(e.name)) {
      const relPath = path.relative(base, full);
      files.push({ 
        path: relPath.split(path.sep).join('/'),
        content: await fs.readFile(full)
      });
    }
  }
}

await collect('../workflows/org-org_REDACTED/chrome_install_typescript', '../workflows/org-org_REDACTED/chrome_install_typescript');
console.log(`Found ${files.length} files`);

const mgr = new WorkflowFileManager();
for (const f of files.slice(0, 5)) {
  console.log(`Uploading ${f.path}...`);
  const r = await mgr.uploadWorkflowFiles(wfId, '1.0.1', [f]);
  console.log(r.success ? '✓' : `✗ ${r.error}`);
}
