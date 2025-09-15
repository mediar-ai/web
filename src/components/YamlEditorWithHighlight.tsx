'use client';

import React from 'react';
import Editor from 'react-simple-code-editor';
import { highlight, languages } from 'prismjs';
import 'prismjs/components/prism-yaml';
import 'prismjs/themes/prism-tomorrow.css';

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
  const highlightCode = (code: string) => {
    try {
      return highlight(code, languages.yaml, 'yaml');
    } catch (error) {
      console.error('Syntax highlighting error:', error);
      return code;
    }
  };

  return (
    <div className={`border border-gray-300 rounded-lg overflow-hidden bg-gray-900 ${className}`}>
      <Editor
        value={value}
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