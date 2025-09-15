'use client';

import React, { useEffect, useState } from 'react';
import Editor from 'react-simple-code-editor';

interface YamlEditorWithHighlightProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  readOnly?: boolean;
}

export function YamlEditorWithHighlight({
  value,
  onChange,
  placeholder,
  className = '',
  minHeight = '500px',
  readOnly = false
}: YamlEditorWithHighlightProps) {
  // Ensure value is always a string
  const safeValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const [Prism, setPrism] = useState<any>(null);

  useEffect(() => {
    // Dynamically import Prism only on client side
    const loadPrism = async () => {
      const prismModule = await import('prismjs');
      // @ts-expect-error - TypeScript doesn't have types for these imports
      await import('prismjs/components/prism-yaml');
      // @ts-expect-error - TypeScript doesn't have types for these imports
      await import('prismjs/themes/prism-tomorrow.css');
      setPrism(prismModule.default);
    };

    if (typeof window !== 'undefined') {
      loadPrism();
    }
  }, []);

  const highlightCode = (code: string) => {
    if (!Prism || !Prism.languages || !Prism.languages.yaml) {
      return code; // Return unhighlighted code if Prism isn't loaded yet
    }

    try {
      return Prism.highlight(code, Prism.languages.yaml, 'yaml');
    } catch (error) {
      console.error('Syntax highlighting error:', error);
      return code;
    }
  };

  return (
    <div className={`border border-gray-300 rounded-lg overflow-hidden bg-gray-900 ${className}`}>
      <Editor
        value={safeValue}
        onValueChange={onChange}
        highlight={highlightCode}
        padding={16}
        disabled={readOnly}
        placeholder={placeholder}
        style={{
          fontFamily: '"Fira Code", "Fira Mono", monospace',
          fontSize: 14,
          minHeight: minHeight,
          backgroundColor: '#2d2d2d',
          color: '#f8f8f2',
          caretColor: '#f8f8f2',
        }}
        textareaClassName="focus:outline-none"
        preClassName="!overflow-visible"
      />
    </div>
  );
}