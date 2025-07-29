import { promises as fs } from 'fs';
import path from 'path';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// This is now a Server Component, so we can fetch data directly on the server.
export default async function EventsApiPage() {
  // Read the markdown file from the public directory
  const filePath = path.join(process.cwd(), 'public', 'WINDOWS_EVENTS_API.md');
  const markdown = await fs.readFile(filePath, 'utf-8');

  return (
    <div className="container mx-auto max-w-7xl py-8 px-4">
      <div className="p-8 rounded-lg border bg-card text-card-foreground shadow-sm">
        <article className="prose prose-zinc dark:prose-invert max-w-none">
          {/* We add remarkGfm to support GitHub Flavored Markdown like tables */}
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
} 