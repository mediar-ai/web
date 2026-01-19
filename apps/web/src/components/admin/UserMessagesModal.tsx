'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2, MessageSquare, BarChart3, ChevronDown, ChevronRight, User, Bot, Send, Sparkles, Copy, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { fetchJson } from '@/lib/fetch-utils';
import { Streamdown } from 'streamdown';

interface Message {
  role: 'user' | 'assistant';
  content: string | { type: string; text?: string; name?: string }[];
  timestamp?: string;
}

interface Session {
  id: string;
  title: string | null;
  message_count: number;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface UserMessagesModalProps {
  userId: string;
  userEmail: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MessageContent({ content }: { content: string | { type: string; text?: string; name?: string }[] }) {
  if (typeof content === 'string') {
    return (
      <pre className="whitespace-pre-wrap font-mono text-sm text-gray-800 break-words">
        {content.length > 1000 ? content.slice(0, 1000) + '...' : content}
      </pre>
    );
  }

  if (Array.isArray(content)) {
    return (
      <div className="space-y-1">
        {content.map((item, idx) => {
          if (item.type === 'text' && item.text) {
            return (
              <pre key={idx} className="whitespace-pre-wrap font-mono text-sm text-gray-800 break-words">
                {item.text.length > 500 ? item.text.slice(0, 500) + '...' : item.text}
              </pre>
            );
          }
          if (item.type === 'tool_use' && item.name) {
            return (
              <div key={idx} className="inline-block px-2 py-0.5 bg-gray-200 text-gray-700 text-xs font-mono">
                tool: {item.name}
              </div>
            );
          }
          if (item.type === 'tool_result') {
            return (
              <div key={idx} className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-mono">
                [tool result]
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  }

  return <span className="text-gray-500 text-sm">[unknown content]</span>;
}

function SessionMessages({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-2 border-black mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 bg-gray-100 flex items-center justify-between hover:bg-gray-200 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="font-mono text-sm font-bold truncate max-w-[300px]">
            {session.title || 'Untitled Session'}
          </span>
          <span className="font-mono text-xs text-gray-500">
            ({session.message_count} messages)
          </span>
        </div>
        <span className="font-mono text-xs text-gray-500">
          {formatDate(session.updated_at)}
        </span>
      </button>

      {expanded && (
        <div className="p-3 space-y-3 max-h-[400px] overflow-y-auto">
          {session.messages && session.messages.length > 0 ? (
            session.messages.map((msg, idx) => (
              <div
                key={idx}
                className={`p-2 border ${msg.role === 'user' ? 'border-black bg-gray-50' : 'border-gray-300 bg-white'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {msg.role === 'user' ? (
                    <User className="w-3 h-3" />
                  ) : (
                    <Bot className="w-3 h-3" />
                  )}
                  <span className="font-mono text-xs font-bold uppercase">
                    {msg.role}
                  </span>
                </div>
                <MessageContent content={msg.content} />
              </div>
            ))
          ) : (
            <p className="font-mono text-sm text-gray-500">No messages in this session</p>
          )}
        </div>
      )}
    </div>
  );
}

const DEFAULT_ANALYSIS_PROMPT = `Analyze these user chat conversations and provide:
1. Summary of what the user was trying to accomplish
2. Common topics/themes discussed
3. Any issues or frustrations encountered
4. Feature requests or suggestions mentioned
5. Overall sentiment and engagement level`;

const SAMPLE_PROMPTS = [
  'What was this user trying to accomplish?',
  'What issues did they encounter?',
  'Summarize the key topics discussed',
  'Any feature requests mentioned?',
];

export function UserMessagesModal({ userId, userEmail, open, onOpenChange }: UserMessagesModalProps) {
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Chat state for Analysis tab
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState(DEFAULT_ANALYSIS_PROMPT);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [conversationLoaded, setConversationLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Flatten all messages for analysis
  const allUserMessages = useMemo(() => {
    const messages: Message[] = [];
    for (const session of sessions) {
      if (session.messages) {
        messages.push(...session.messages);
      }
    }
    return messages;
  }, [sessions]);

  useEffect(() => {
    if (open && userId) {
      setLoading(true);
      setError(null);
      // Reset chat state for new user
      setChatMessages([]);
      setInputValue(DEFAULT_ANALYSIS_PROMPT);
      setChatError(null);
      setConversationLoaded(false);

      // Load sessions and existing conversation in parallel
      Promise.all([
        fetchJson<{ sessions: Session[] }>(`/api/admin/user-messages/${userId}`),
        fetchJson<{ success: boolean; conversation: { messages: ChatMessage[] } | null }>(
          `/api/admin/user-messages/${userId}/conversations`
        ).catch(() => ({ success: false, conversation: null })), // Graceful fallback if conversation doesn't exist
      ])
        .then(([sessionsData, conversationData]) => {
          setSessions(sessionsData.sessions || []);

          // Load existing conversation if available
          if (conversationData.success && conversationData.conversation?.messages?.length) {
            setChatMessages(conversationData.conversation.messages);
            setInputValue(''); // Clear default prompt when conversation exists
          }
          setConversationLoaded(true);
        })
        .catch(err => {
          console.error('Failed to fetch user messages:', err);
          setError(err instanceof Error ? err.message : 'Failed to load messages');
          setConversationLoaded(true);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, userId]);

  // Scroll to bottom when chat messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const stats = useMemo(() => {
    const totalMessages = sessions.reduce((sum, s) => sum + (s.message_count || 0), 0);
    const totalSessions = sessions.length;
    const userMessages = sessions.reduce((sum, s) => {
      if (!s.messages) return sum;
      return sum + s.messages.filter(m => m.role === 'user').length;
    }, 0);
    const assistantMessages = sessions.reduce((sum, s) => {
      if (!s.messages) return sum;
      return sum + s.messages.filter(m => m.role === 'assistant').length;
    }, 0);

    return { totalMessages, totalSessions, userMessages, assistantMessages };
  }, [sessions]);

  const copyToClipboard = async (text: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Save conversation to database
  const saveConversation = async (messages: ChatMessage[]) => {
    try {
      await fetch(`/api/admin/user-messages/${userId}/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
    } catch (err) {
      console.error('Failed to save conversation:', err);
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();

    const userPrompt = inputValue.trim();
    if (!userPrompt || allUserMessages.length === 0) return;

    // Add user message to chat
    const userMessageObj: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userPrompt,
    };

    setChatMessages(prev => [...prev, userMessageObj]);
    setInputValue('');
    setIsAnalyzing(true);
    setChatError(null);

    try {
      const response = await fetch(`/api/admin/user-messages/${userId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userPrompt,
          userMessages: allUserMessages,
          chatHistory: chatMessages,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const data = await response.json();

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.text || 'No response generated',
      };

      // Update chat messages and save to database
      const updatedMessages = [...chatMessages, userMessageObj, assistantMessage];
      setChatMessages(updatedMessages);
      saveConversation(updatedMessages);
    } catch (err) {
      console.error('Analysis error:', err);
      setChatError(err instanceof Error ? err.message : 'Failed to analyze messages');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSamplePrompt = (prompt: string) => {
    setInputValue(prompt);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="5xl" className="border-2 border-black max-h-[85vh] flex flex-col">
        <DialogHeader className="border-b border-gray-200 pb-4">
          <DialogTitle className="text-xl font-mono font-bold flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Messages for {userEmail}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : error ? (
            <div className="p-4 border-2 border-black bg-gray-50">
              <p className="font-mono text-sm text-red-600">{error}</p>
            </div>
          ) : (
            <Tabs defaultValue="history" className="h-full flex flex-col">
              <TabsList>
                <TabsTrigger value="history">
                  <MessageSquare className="w-4 h-4 mr-1" />
                  History ({stats.totalMessages})
                </TabsTrigger>
                <TabsTrigger value="analysis">
                  <Sparkles className="w-4 h-4 mr-1" />
                  Analysis
                </TabsTrigger>
              </TabsList>

              <TabsContent value="history" className="flex-1 min-h-0 mt-4">
                {sessions.length === 0 ? (
                  <div className="p-4 border-2 border-black bg-gray-50">
                    <p className="font-mono text-sm text-gray-600">No chat sessions found for this user.</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(85vh-220px)]">
                    <div className="pr-4">
                      {sessions.map(session => (
                        <SessionMessages key={session.id} session={session} />
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </TabsContent>

              <TabsContent value="analysis" className="flex-1 min-h-0 mt-4 flex flex-col">
                {allUserMessages.length === 0 ? (
                  <div className="p-4 border-2 border-black bg-gray-50">
                    <p className="font-mono text-sm text-gray-600">No messages to analyze.</p>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    {/* Stats Header */}
                    <div className="grid grid-cols-4 gap-2 mb-4">
                      <div className="border border-black p-2 text-center">
                        <p className="font-mono text-xs text-gray-600">Sessions</p>
                        <p className="font-mono text-lg font-bold">{stats.totalSessions}</p>
                      </div>
                      <div className="border border-black p-2 text-center">
                        <p className="font-mono text-xs text-gray-600">Messages</p>
                        <p className="font-mono text-lg font-bold">{stats.totalMessages}</p>
                      </div>
                      <div className="border border-black p-2 text-center">
                        <p className="font-mono text-xs text-gray-600">User</p>
                        <p className="font-mono text-lg font-bold">{stats.userMessages}</p>
                      </div>
                      <div className="border border-black p-2 text-center">
                        <p className="font-mono text-xs text-gray-600">Assistant</p>
                        <p className="font-mono text-lg font-bold">{stats.assistantMessages}</p>
                      </div>
                    </div>

                    {/* Chat Messages */}
                    <div className="h-[calc(85vh-380px)] overflow-y-auto mb-4 space-y-3 border-2 border-black p-3 bg-gray-50">
                      {chatMessages.length === 0 ? (
                        <div className="text-center py-8">
                          <Sparkles className="w-10 h-10 mx-auto mb-3 text-gray-400" />
                          <p className="font-mono text-sm text-gray-600 mb-3">
                            Ask AI to analyze this user's conversations
                          </p>
                          <div className="flex flex-wrap gap-2 justify-center">
                            {SAMPLE_PROMPTS.map((prompt, idx) => (
                              <button
                                key={idx}
                                onClick={() => handleSamplePrompt(prompt)}
                                className="px-2 py-1 text-xs border border-black bg-white hover:bg-black hover:text-white transition-colors"
                              >
                                {prompt}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <>
                          {chatMessages.map((message) => (
                            <div
                              key={message.id}
                              className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                              {message.role === 'assistant' && (
                                <div className="w-7 h-7 border-2 border-black rounded-full flex items-center justify-center bg-black flex-shrink-0">
                                  <Sparkles className="w-3 h-3 text-white" />
                                </div>
                              )}
                              <div
                                className={`max-w-[80%] rounded-lg p-3 ${
                                  message.role === 'user'
                                    ? 'bg-black text-white'
                                    : 'bg-white border-2 border-black'
                                }`}
                              >
                                {message.role === 'user' ? (
                                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                                ) : (
                                  <>
                                    <Streamdown
                                      parseIncompleteMarkdown={true}
                                      shikiTheme={['github-light', 'github-dark']}
                                      className="text-sm"
                                    >
                                      {message.content}
                                    </Streamdown>
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
                                <div className="w-7 h-7 border-2 border-black rounded-full flex items-center justify-center bg-white flex-shrink-0">
                                  <User className="w-3 h-3" />
                                </div>
                              )}
                            </div>
                          ))}
                          {isAnalyzing && (
                            <div className="flex gap-2">
                              <div className="w-7 h-7 border-2 border-black rounded-full flex items-center justify-center bg-black flex-shrink-0">
                                <Sparkles className="w-3 h-3 text-white animate-pulse" />
                              </div>
                              <div className="bg-white border-2 border-black rounded-lg p-3">
                                <Loader2 className="w-4 h-4 animate-spin" />
                              </div>
                            </div>
                          )}
                          <div ref={messagesEndRef} />
                        </>
                      )}
                    </div>

                    {/* Error Alert */}
                    {chatError && (
                      <Alert className="mb-3 border-black">
                        <AlertDescription>
                          <span className="text-sm">{chatError}</span>
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Input Form */}
                    <form onSubmit={handleAnalyze} className="border-t-2 border-black pt-3">
                      <div className="flex gap-2">
                        <Textarea
                          value={inputValue}
                          onChange={(e) => setInputValue(e.target.value)}
                          placeholder="Ask about the user's conversations..."
                          className="flex-1 min-h-[60px] max-h-[100px] font-mono text-sm border-2 border-black focus:outline-none focus:ring-2 focus:ring-black resize-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleAnalyze(e);
                            }
                          }}
                          disabled={isAnalyzing}
                        />
                        <Button
                          type="submit"
                          disabled={!inputValue.trim() || isAnalyzing || allUserMessages.length === 0}
                          className="bg-black text-white hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-500"
                        >
                          {isAnalyzing ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 font-mono">
                        Gemini 3 Pro Preview | Enter to send
                      </p>
                    </form>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
