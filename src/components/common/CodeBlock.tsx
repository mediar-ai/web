'use client';

import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { CopyToClipboardButton } from './CopyToClipboardButton';

interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  showCopyButton?: boolean;
  customStyle?: React.CSSProperties;
  className?: string;
}

// Map common language aliases to react-syntax-highlighter language identifiers
const languageMap: Record<string, string> = {
  'js': 'javascript',
  'ts': 'typescript',
  'jsx': 'javascript',
  'tsx': 'typescript',
  'shell': 'bash',
  'sh': 'bash',
  'yml': 'yaml',
  'json5': 'json',
  'jsonc': 'json',
  'curl': 'bash',
  'api': 'http',
  'terminal': 'bash',
  'console': 'bash',
  'cmd': 'bash',
};

// Detect language from content patterns
function detectLanguage(code: string): string {
  // Check for specific patterns
  if (code.trim().startsWith('curl ') || code.includes('curl -X')) return 'bash';
  if (code.trim().startsWith('{') && code.trim().endsWith('}')) return 'json';
  if (code.trim().startsWith('[') && code.trim().endsWith(']')) return 'json';
  if (code.includes('fetch(') || code.includes('.then(')) return 'javascript';
  if (code.includes('const ') || code.includes('let ') || code.includes('var ')) return 'javascript';
  if (code.includes('function ') || code.includes('=>')) return 'javascript';
  if (code.includes('import ') || code.includes('export ')) return 'javascript';
  if (code.includes('<') && code.includes('>')) return 'html';
  if (code.includes('SELECT ') || code.includes('FROM ')) return 'sql';
  if (code.includes('def ') || code.includes('import ')) return 'python';
  
  return 'text';
}

export function CodeBlock({
  code,
  language,
  showLineNumbers = false,
  showCopyButton = true,
  customStyle,
  className = ''
}: CodeBlockProps) {
  // Normalize language
  const detectedLanguage = language ? (languageMap[language.toLowerCase()] || language.toLowerCase()) : detectLanguage(code);

  return (
    <div className={`relative group ${className}`}>
      {showCopyButton && (
        <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <CopyToClipboardButton contentToCopy={code} />
        </div>
      )}
      <SyntaxHighlighter
        language={detectedLanguage}
        style={oneDark}
        showLineNumbers={showLineNumbers}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          ...customStyle
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}