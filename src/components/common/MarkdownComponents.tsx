import React from 'react';
import { CodeBlock } from './CodeBlock';

export const markdownComponents = {
  code({ inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : undefined;
    
    if (!inline && language) {
      return (
        <CodeBlock
          code={String(children).replace(/\n$/, '')}
          language={language}
          showLineNumbers={false}
          showCopyButton={true}
        />
      );
    }
    
    // For inline code
    if (inline) {
      return (
        <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-sm" {...props}>
          {children}
        </code>
      );
    }
    
    // For code blocks without language
    return (
      <CodeBlock
        code={String(children).replace(/\n$/, '')}
        showLineNumbers={false}
        showCopyButton={true}
      />
    );
  }
};