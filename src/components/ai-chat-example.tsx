'use client';

import { useState, useRef, useEffect } from 'react';
import { AIClient } from '@/lib/ai-client';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export function AIChatExample() {
  const [client, setClient] = useState<AIClient | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-1.5-flash');
  const [useStreaming, setUseStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const initializeClient = () => {
    if (apiKey.trim()) {
      setClient(new AIClient(apiKey.trim()));
    }
  };

  const addMessage = (role: 'user' | 'assistant', content: string) => {
    const message: Message = {
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, message]);
    return message.id;
  };

  const updateLastMessage = (content: string) => {
    setMessages(prev => {
      const updated = [...prev];
      if (updated.length > 0) {
        updated[updated.length - 1].content = content;
      }
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || !input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    addMessage('user', userMessage);

    if (useStreaming) {
      setStreaming(true);
      addMessage('assistant', '');
      let fullResponse = '';

      try {
        for await (const chunk of client.generateTextStream({
          prompt: userMessage,
          model,
          temperature: 0.7,
        })) {
          fullResponse += chunk.text;
          updateLastMessage(fullResponse);
        }
      } catch (error) {
        console.error('Streaming error:', error);
        updateLastMessage('Error: Failed to generate response');
      } finally {
        setStreaming(false);
      }
    } else {
      setLoading(true);
      try {
        const response = await client.generateText({
          prompt: userMessage,
          model,
          temperature: 0.7,
        });
        addMessage('assistant', response.text);
      } catch (error) {
        console.error('Generation error:', error);
        addMessage('assistant', 'Error: Failed to generate response');
      } finally {
        setLoading(false);
      }
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold mb-6">AI Chat Example</h1>
        
        {/* Configuration */}
        <div className="space-y-4 mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <h2 className="text-lg font-semibold">Configuration</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                API Password
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API password"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">
                Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800"
              >
                <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                <option value="gemini-2.0-flash-001">Gemini 2.0 Flash</option>
                <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash Exp</option>
              </select>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={useStreaming}
                onChange={(e) => setUseStreaming(e.target.checked)}
                className="mr-2"
              />
              Use Streaming
            </label>
            
            <button
              onClick={initializeClient}
              disabled={!apiKey.trim()}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-md"
            >
              Connect
            </button>
            
            <button
              onClick={clearChat}
              className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md"
            >
              Clear Chat
            </button>
          </div>
          
          {client && (
            <p className="text-sm text-green-600 dark:text-green-400">
              [SUCCESS] Client initialized successfully
            </p>
          )}
        </div>

        {/* Chat Messages */}
        <div className="h-96 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded-lg p-4 mb-4 bg-gray-50 dark:bg-gray-900">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
              No messages yet. Start a conversation!
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      message.role === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    <div className="text-sm">
                      <div className="font-semibold mb-1">
                        {message.role === 'user' ? 'You' : 'AI'}
                      </div>
                      <div className="whitespace-pre-wrap">
                        {message.content}
                      </div>
                      <div className="text-xs opacity-75 mt-1">
                        {message.timestamp.toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {(loading || streaming) && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2">
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                      <span className="text-sm">
                        {streaming ? 'Streaming...' : 'Thinking...'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={!client || loading || streaming}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 disabled:bg-gray-100 dark:disabled:bg-gray-700"
          />
          <button
            type="submit"
            disabled={!client || !input.trim() || loading || streaming}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-md"
          >
            Send
          </button>
        </form>

        {/* Status */}
        <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          Status: {!client ? 'Not connected' : loading || streaming ? 'Processing...' : 'Ready'}
          {client && (
            <span className="ml-4">
              Model: {model} | Streaming: {useStreaming ? 'On' : 'Off'}
            </span>
          )}
        </div>
      </div>

      {/* Usage Instructions */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-2">
          How to use:
        </h3>
        <ol className="list-decimal list-inside text-sm text-blue-700 dark:text-blue-300 space-y-1">
          <li>Enter your API password (set in your environment variables)</li>
          <li>Choose your preferred AI model</li>
          <li>Toggle streaming mode if you want real-time responses</li>
          <li>Click &quot;Connect&quot; to initialize the client</li>
          <li>Start chatting with the AI!</li>
        </ol>
      </div>
    </div>
  );
}