'use client';

import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

export default function EventsApiPage() {
  const [markdown, setMarkdown] = useState('');

  useEffect(() => {
    fetch('/WINDOWS_EVENTS_API.md')
      .then((response) => response.text())
      .then((text) => setMarkdown(text));
  }, []);

  return (
    <div className="container mx-auto py-8">
      <article className="prose lg:prose-xl">
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </article>
    </div>
  );
} 