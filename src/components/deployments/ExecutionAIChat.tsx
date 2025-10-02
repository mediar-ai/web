'use client';

import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Execution } from '@/lib/workflow-types';
import { Send, Sparkles, User, Loader2, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

interface ExecutionAIChatProps {
  execution: Execution;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function ExecutionAIChat({ execution }: ExecutionAIChatProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Sample questions
  const sampleQuestions = [
    'What did this workflow accomplish?',
    'Were there any errors in this execution?',
    'Explain the results in simple terms',
    'What took the most time in this run?',
  ];

  const handleSampleQuestion = (question: string) => {
    setInputValue(question);
  };

  const copyToClipboard = async (text: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const userMessage = inputValue.trim();
    if (!userMessage) return;

    // Add user message to chat
    const userMessageObj: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
    };

    setMessages(prev => [...prev, userMessageObj]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/execution-qa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessageObj],
          executionId: execution.execution_id, // Only send the ID, server will fetch the full context
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      if (reader) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '',
        };

        // Add empty assistant message
        setMessages(prev => [...prev, assistantMessage]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          // Process the streaming response
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.trim()) {
              // Handle different streaming formats
              // Format 1: "0:content"
              if (line.startsWith('0:')) {
                const content = line.slice(2).replace(/^"|"$/g, '').trim();
                if (content) {
                  assistantContent += content;
                }
              }
              // Format 2: Plain text
              else if (!line.startsWith('data:') && !line.includes(':')) {
                assistantContent += line;
              }
              // Format 3: SSE data format
              else if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data && data !== '[DONE]') {
                  try {
                    const parsed = JSON.parse(data);
                    if (parsed.content) {
                      assistantContent += parsed.content;
                    }
                  } catch {
                    // If not JSON, treat as plain text
                    assistantContent += data;
                  }
                }
              }

              // Update the message in real-time
              if (assistantContent) {
                setMessages(prev => {
                  const newMessages = [...prev];
                  const lastMessage = newMessages[newMessages.length - 1];
                  if (lastMessage && lastMessage.role === 'assistant') {
                    lastMessage.content = assistantContent;
                  }
                  return newMessages;
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Chat error:', err);
      setError(err instanceof Error ? err : new Error('Failed to send message'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b-2 border-black pb-3 mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          <h3 className="font-mono font-bold uppercase">AI Assistant</h3>
          <Badge className="bg-black text-white text-xs">
            GEMINI 2.5 PRO
          </Badge>
        </div>
        <p className="text-sm text-gray-600 mt-1">
          Ask questions about this execution to understand what happened
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 mb-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <Sparkles className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="text-sm text-gray-600 mb-4">
              Ask me anything about this execution
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {sampleQuestions.map((question, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSampleQuestion(question)}
                  className="px-3 py-1.5 text-xs border-2 border-black bg-white hover:bg-black hover:text-white transition-colors rounded-md"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {message.role === 'assistant' && (
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 border-2 border-black rounded-full flex items-center justify-center bg-black">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                  </div>
                )}
                <div
                  className={`max-w-[80%] ${
                    message.role === 'user'
                      ? 'bg-black text-white'
                      : 'bg-gray-50 border-2 border-black'
                  } rounded-lg p-3`}
                >
                  {message.role === 'user' ? (
                    <div className="text-sm text-white">
                      {message.content.split('\n').map((line, idx) => (
                        <p key={idx} className={idx > 0 ? 'mt-2' : ''}>
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="prose prose-sm max-w-none
                        prose-headings:font-mono prose-headings:text-black prose-headings:font-bold prose-headings:my-3
                        prose-p:text-black prose-p:my-2 prose-p:leading-relaxed
                        prose-strong:font-bold prose-strong:text-black
                        prose-code:bg-gray-200 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-black prose-code:font-mono prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
                        prose-pre:bg-black prose-pre:text-white prose-pre:p-3 prose-pre:rounded prose-pre:border-2 prose-pre:border-black prose-pre:my-3
                        prose-ul:my-2 prose-ol:my-2 prose-ul:list-disc prose-ol:list-decimal prose-ul:ml-6 prose-ol:ml-6
                        prose-li:text-black prose-li:marker:text-black prose-li:my-1
                        prose-blockquote:border-l-4 prose-blockquote:border-black prose-blockquote:pl-4 prose-blockquote:my-3 prose-blockquote:text-gray-700
                        prose-hr:border-black prose-hr:my-4
                        prose-a:text-black prose-a:underline prose-a:font-bold hover:prose-a:text-gray-700
                        prose-table:border-2 prose-table:border-black prose-table:my-3
                        prose-th:border prose-th:border-black prose-th:bg-gray-100 prose-th:px-2 prose-th:py-1 prose-th:font-mono
                        prose-td:border prose-td:border-black prose-td:px-2 prose-td:py-1">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkBreaks]}
                          rehypePlugins={[rehypeHighlight]}
                          components={{
                            code({ inline, className, children, ...props }: any) {
                              const match = /language-(\w+)/.exec(className || '');
                              return !inline && match ? (
                                <div className="relative my-3">
                                  <div className="absolute top-0 right-0 text-xs font-mono text-gray-400 bg-black px-2 py-1 border-b border-l border-gray-700">
                                    {match[1]}
                                  </div>
                                  <pre className={`${className} overflow-x-auto`} {...props}>
                                    <code className={className} {...props}>
                                      {children}
                                    </code>
                                  </pre>
                                </div>
                              ) : (
                                <code className="bg-gray-200 px-1 py-0.5 rounded text-black font-mono text-xs" {...props}>
                                  {children}
                                </code>
                              );
                            },
                            p({ children, ...props }: any) {
                              return <p className="mb-2" {...props}>{children}</p>;
                            },
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                      {/* Copy button for AI messages */}
                      <div className="flex justify-start mt-2">
                        <button
                          onClick={() => copyToClipboard(message.content, message.id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-mono border border-black rounded hover:bg-black hover:text-white transition-colors"
                        >
                          {copiedMessageId === message.id ? (
                            <>
                              <Check className="w-3 h-3" />
                              COPIED
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              COPY
                            </>
                          )}
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {message.role === 'user' && (
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 border-2 border-black rounded-full flex items-center justify-center bg-white">
                      <User className="w-4 h-4" />
                    </div>
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 border-2 border-black rounded-full flex items-center justify-center bg-black">
                    <Sparkles className="w-4 h-4 text-white animate-pulse" />
                  </div>
                </div>
                <div className="bg-gray-50 border-2 border-black rounded-lg p-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <Alert className="mb-4 border-black">
          <AlertDescription>
            <span className="text-sm">{error.message}</span>
          </AlertDescription>
        </Alert>
      )}

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="border-t-2 border-black pt-4">
        <div className="flex gap-2">
          <Textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask about the execution results, errors, or performance..."
            className="flex-1 min-h-[60px] max-h-[120px] font-mono text-sm border-2 border-black focus:outline-none focus:ring-2 focus:ring-black resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            disabled={isLoading}
          />
          <Button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            className="bg-black text-white hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-500"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </form>
    </div>
  );
}