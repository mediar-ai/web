'use client';

import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Execution } from '@/lib/workflow-types';
import { Send, Sparkles, User, Loader2, Copy, Check } from 'lucide-react';
import { Streamdown } from 'streamdown';

interface ExecutionAIChatProps {
  execution: Execution;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function ExecutionAIChat({ execution }: ExecutionAIChatProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [_isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [contextData, setContextData] = useState<any | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(true);
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-pro');

  // Load context data once when component mounts
  useEffect(() => {
    const loadContext = async () => {
      if (!execution.execution_id) {
        setIsLoadingContext(false);
        return;
      }

      try {
        setIsLoadingContext(true);
        console.log('[QA] Loading context for execution:', execution.execution_id);

        const response = await fetch(
          `/api/ai/execution-qa/context?executionId=${execution.execution_id}`
        );

        if (response.ok) {
          const data = await response.json();
          setContextData(data);
          console.log(`[QA] Context loaded - ${data.metadata.jsFileCount} JS files, ${data.metadata.workflowSteps} steps`);
        } else {
          console.error('[QA] Failed to load context:', response.status);
        }
      } catch (error) {
        console.error('[QA] Failed to load context:', error);
      } finally {
        setIsLoadingContext(false);
      }
    };

    loadContext();
  }, [execution.execution_id]);

  // Load conversation history on mount
  useEffect(() => {
    const loadConversation = async () => {
      if (!execution.execution_id) {
        setIsLoadingHistory(false);
        return;
      }

      try {
        setIsLoadingHistory(true);

        const response = await fetch(
          `/api/ai/execution-qa/conversations?executionId=${execution.execution_id}`
        );

        if (response.ok) {
          const data = await response.json();

          if (data.conversation && data.conversation.messages) {
            setConversationId(data.conversation.id);
            setMessages(data.conversation.messages);
            console.log(`[QA] Loaded ${data.conversation.messages.length} messages from history`);
          }
        }
      } catch (error) {
        console.error('[QA] Failed to load conversation:', error);
        // Don't show error to user, just start fresh
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadConversation();
  }, [execution.execution_id]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Sample questions
  const sampleQuestions = [
    'Review execution logs in detail and call relevant tools. What happened in this workflow? Identify the first failed step, then analyze all steps that succeeded before it - review their logs for timing issues, unexpected UI states, or warnings that might indicate the root cause. Understand the user intent and business logic of the workflow. In UI automation workflows, the failed step is often a symptom; the actual issue may be in earlier steps that appeared to succeed.',
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

    // Add system message showing data loading
    const loadingMessageId = `loading-${Date.now()}`;
    const loadingMessage: Message = {
      id: loadingMessageId,
      role: 'system',
      content: '⏳ Loading execution data and Terminator documentation...',
    };
    setMessages(prev => [...prev, loadingMessage]);

    try {
      console.log('[Q&A Client] Sending request:', { executionId: execution.execution_id, messageCount: messages.length + 1 });

      const response = await fetch('/api/ai/execution-qa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessageObj],
          executionId: execution.execution_id,
          // Pass pre-loaded context to avoid re-fetching on every message
          contextData: contextData,
          model: selectedModel,
        }),
      });

      console.log('[Q&A Client] Response status:', response.status);
      console.log('[Q&A Client] Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Q&A Client] Error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      // Remove loading message
      setMessages(prev => prev.filter(m => m.id !== loadingMessageId));

      // Get JSON response (non-streaming)
      const data = await response.json();
      console.log('[Q&A Client] Received response:', { textLength: data.text?.length, turns: data.turns });

      // Add assistant message with response
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.text || 'No response generated',
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Save conversation
      try {
        const updatedMessages = [
          ...messages,
          userMessageObj,
          assistantMessage
        ];

        const saveResponse = await fetch('/api/ai/execution-qa/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            executionId: execution.execution_id,
            messages: updatedMessages,
          }),
        });

        if (saveResponse.ok) {
          const saveData = await saveResponse.json();
          if (saveData.conversationId && !conversationId) {
            setConversationId(saveData.conversationId);
          }
          console.log('[QA] Conversation saved successfully');
        } else {
          console.warn('[QA] Failed to save conversation:', await saveResponse.text());
        }
      } catch (saveError) {
        console.error('[QA] Error saving conversation:', saveError);
        // Don't show error to user, conversation still works
      }
    } catch (err) {
      console.error('Chat error:', err);
      setError(err instanceof Error ? err : new Error('Failed to send message'));
      // Remove loading message on error
      setMessages(prev => prev.filter(m => m.id !== loadingMessageId));
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
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="w-[180px] h-7 border-2 border-black font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
              <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
            </SelectContent>
          </Select>
          {isLoadingContext && (
            <Badge className="bg-white text-black border border-black text-xs animate-pulse">
              <Loader2 className="w-3 h-3 mr-1 animate-spin inline" />
              Loading context...
            </Badge>
          )}
          {!isLoadingContext && contextData && (
            <Badge className="bg-gray-100 text-black text-xs">
              {contextData.metadata.jsFileCount} JS files loaded
            </Badge>
          )}
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
                  message.role === 'user' ? 'justify-end' : message.role === 'system' ? 'justify-center' : 'justify-start'
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
                      : message.role === 'system'
                      ? 'bg-gray-100 border border-gray-300 text-gray-700 text-xs italic'
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
                  ) : message.role === 'system' ? (
                    <div className="text-xs">
                      {message.content}
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