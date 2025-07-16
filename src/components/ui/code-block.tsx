import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';
import { CopyToClipboardButton } from '@/components/common/CopyToClipboardButton';

interface CodeBlockProps {
  children: string;
  language?: 'json' | 'javascript' | 'bash' | 'curl' | 'text' | 'log' | 'sql' | 'python' | 'typescript' | 'jsx' | 'tsx';
  theme?: 'dark' | 'light';
  size?: 'sm' | 'md' | 'lg';
  showCopy?: boolean;
  showLineNumbers?: boolean;
  maxHeight?: string;
  title?: string;
  filename?: string;
  className?: string;
  copyLabel?: string;
}

export function CodeBlock({
  children,
  language = 'text',
  theme = 'dark',
  size = 'md',
  showCopy = true,
  showLineNumbers = false,
  maxHeight,
  title,
  filename,
  className,
  copyLabel
}: CodeBlockProps) {
  const formatContent = () => {
    if (language === 'json') {
      try {
        return JSON.stringify(JSON.parse(children), null, 2);
      } catch {
        return children;
      }
    }
    return children;
  };

  // Map our language types to react-syntax-highlighter languages
  const getLanguageForHighlighter = (lang: string) => {
    switch (lang) {
      case 'curl':
        return 'bash';
      case 'log':
        return 'text';
      default:
        return lang;
    }
  };

  const themeClasses = {
    dark: 'bg-gray-900 text-gray-100 border-2 border-black',
    light: 'bg-gray-50 text-gray-900 border-2 border-black'
  };

  const sizeClasses = {
    sm: 'text-xs',
    md: 'text-sm', 
    lg: 'text-base'
  };

  const content = formatContent();
  const hasHeader = title || filename || showCopy;
  const syntaxTheme = theme === 'dark' ? vscDarkPlus : vs;

  return (
    <div className={cn('relative rounded-lg overflow-hidden', themeClasses[theme], className)}>
      {/* Header */}
      {hasHeader && (
        <div className={cn(
          'flex items-center justify-between px-3 py-2 border-b-2 border-black',
          theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'
        )}>
          <div className="flex items-center gap-2">
            {filename && (
              <span className="text-xs text-muted-foreground font-mono">
                {filename}
              </span>
            )}
            {title && (
              <span className="text-sm font-medium">{title}</span>
            )}
            {language !== 'text' && (
              <span className={cn(
                "text-xs px-2 py-1 rounded font-mono border border-black",
                theme === 'dark' 
                  ? 'bg-gray-700 text-gray-300' 
                  : 'bg-white text-gray-600'
              )}>
                {language}
              </span>
            )}
          </div>
          {showCopy && (
            <div className="flex items-center">
              <CopyToClipboardButton 
                contentToCopy={content}
                aria-label={copyLabel || `Copy ${language} code`}
                className={cn(
                  "h-7 px-2 border border-black",
                  theme === 'dark' 
                    ? 'bg-gray-700 text-gray-200 hover:bg-gray-600 hover:text-white' 
                    : 'bg-white text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                )}
              />
            </div>
          )}
        </div>
      )}

      {/* Code Content */}
      <div className={cn(
        'relative',
        maxHeight && 'overflow-auto',
        sizeClasses[size]
      )} style={maxHeight ? { maxHeight } : undefined}>
        {language === 'text' || language === 'log' ? (
          // For plain text/logs, use simple pre tag to preserve formatting
                      <pre className={cn(
              'p-3 m-0 font-mono whitespace-pre-wrap break-words',
              theme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'
            )}>
              {content}
            </pre>
        ) : (
          // For code, use syntax highlighter with CSS isolation
          <div className="syntax-highlighter-wrapper [&_pre]:!bg-transparent [&_code]:!bg-transparent [&_.token]:opacity-100">
            <SyntaxHighlighter
              language={getLanguageForHighlighter(language)}
              style={syntaxTheme}
              showLineNumbers={showLineNumbers}
              customStyle={{
                margin: 0,
                padding: '12px',
                fontSize: 'inherit',
                background: 'transparent',
                lineHeight: '1.5',
              }}
              codeTagProps={{
                style: {
                  fontSize: 'inherit',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Inconsolata, "Roboto Mono", monospace',
                  background: 'transparent',
                }
              }}
              PreTag={({ children, ...props }) => (
                <pre {...props} style={{ ...props.style, background: 'transparent' }}>
                  {children}
                </pre>
              )}
            >
              {content}
            </SyntaxHighlighter>
          </div>
        )}
      </div>
    </div>
  );
}

// Convenience component for JSON data
export function JsonBlock({ 
  data, 
  title = "JSON",
  ...props 
}: Omit<CodeBlockProps, 'children' | 'language'> & { 
  data: unknown;
}) {
  return (
    <CodeBlock 
      language="json" 
      title={title}
      {...props}
    >
      {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
    </CodeBlock>
  );
}

// Convenience component for API requests  
export function ApiRequestBlock({ 
  method, 
  url, 
  body, 
  headers = {},
  ...props 
}: Omit<CodeBlockProps, 'children' | 'language'> & {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const request = `${method} ${url}
${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n')}

${body ? JSON.stringify(body, null, 2) : ''}`.trim();

  return (
    <CodeBlock 
      language="curl" 
      title="API Request"
      {...props}
    >
      {request}
    </CodeBlock>
  );
} 