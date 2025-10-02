'use client';

import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Execution } from '@/lib/workflow-types';
import { Send, Sparkles, User, Loader2 } from 'lucide-react';

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
      // Truncate large fields to avoid 413 errors
      const truncateField = (field: any, maxLength: number = 5000) => {
        if (!field) return field;
        const str = typeof field === 'string' ? field : JSON.stringify(field);
        if (str.length > maxLength) {
          return str.substring(0, maxLength) + '... [truncated]';
        }
        return field;
      };

      // Only send recent logs to avoid payload size issues
      const recentLogs = execution.execution_logs?.slice(-50) || [];

      const response = await fetch('/api/ai/execution-qa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessageObj],
          executionContext: {
            execution_id: execution.execution_id,
            workflow_name: execution.workflow_name,
            status: execution.status,
            duration: execution.execution_duration_seconds,
            error_message: truncateField(execution.error_message, 2000),
            formatted_output: truncateField(execution.formatted_output, 10000),
            results: truncateField(execution.results, 10000),
            execution_logs: recentLogs,
          },
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
            GEMINI 2.5 FLASH
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
                  <div
                    className={`text-sm ${
                      message.role === 'user' ? 'text-white' : 'text-black'
                    }`}
                  >
                    {message.content.split('\n').map((line, idx) => (
                      <p key={idx} className={idx > 0 ? 'mt-2' : ''}>
                        {line}
                      </p>
                    ))}
                  </div>
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