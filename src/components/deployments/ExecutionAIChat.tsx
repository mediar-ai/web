'use client';

import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Execution } from '@/lib/workflow-types';
import { Send, Sparkles, User, Loader2, Copy, Check } from 'lucide-react';
import { Streamdown } from 'streamdown';

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
      console.log('[Q&A Client] Sending request:', { executionId: execution.execution_id, messageCount: messages.length + 1 });

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

      console.log('[Q&A Client] Response status:', response.status);
      console.log('[Q&A Client] Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Q&A Client] Error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let buffer = '';

      if (reader) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '',
        };

        // Add empty assistant message
        setMessages(prev => [...prev, assistantMessage]);

        let chunkCount = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('[Q&A Client] Stream done, received', chunkCount, 'chunks');
            break;
          }

          chunkCount++;
          const chunk = decoder.decode(value, { stream: true });
          console.log(`[Q&A Client] Raw chunk ${chunkCount}:`, chunk.substring(0, 100));

          buffer += chunk;
          const lines = buffer.split('\n');

          // Keep the last incomplete line in the buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;

            console.log('[Q&A Client] Processing line:', line.substring(0, 50));

            if (!line.startsWith('data: ')) {
              console.warn('[Q&A Client] Line does not start with "data: ":', line.substring(0, 50));
              continue;
            }

            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              console.log('[Q&A Client] Parsed:', { type: parsed.type, keys: Object.keys(parsed) });

              // Handle text delta chunks
              if (parsed.type === 'text-delta' && parsed.textDelta) {
                assistantContent += parsed.textDelta;
                console.log('[Q&A Client] Text delta received:', parsed.textDelta.substring(0, 50));

                // Update the message in real-time
                setMessages(prev => {
                  const newMessages = [...prev];
                  const lastMessage = newMessages[newMessages.length - 1];
                  if (lastMessage && lastMessage.role === 'assistant') {
                    lastMessage.content = assistantContent;
                  }
                  return newMessages;
                });
              }
              // Log tool calls for debugging
              else if (parsed.type === 'tool-input-start') {
                console.log('[Tool Call]:', parsed.toolName);
              }
              else if (parsed.type === 'tool-result') {
                console.log('[Tool Result]:', parsed.toolName);
              }
            } catch (e) {
              // Ignore parse errors for malformed chunks
              console.error('[Q&A Client] Failed to parse chunk:', data.substring(0, 100), e);
            }
          }
        }

        if (chunkCount === 0) {
          console.error('[Q&A Client] WARNING: No chunks received!');
          setError(new Error('No response received from AI'));
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
                      <Streamdown
                        parseIncompleteMarkdown={true}
                        shikiTheme={['github-light', 'github-dark']}
                        className="text-sm"
                      >
                        {message.content}
                      </Streamdown>
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