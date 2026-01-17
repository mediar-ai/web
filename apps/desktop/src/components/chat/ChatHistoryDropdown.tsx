import * as Tooltip from "@radix-ui/react-tooltip";
import { History, Loader2, Trash2 } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import type { ChatSessionListItem } from "@/services/chat-sessions-api";
import { deleteLocalSession, getSessionMessages, debugListMessageKeys } from "@/lib/session-storage";

interface MessagePreview {
  role: string;
  content: string;
}

// Cache for fetched session previews
const previewCache = new Map<string, MessagePreview[]>();

interface ChatHistoryDropdownProps {
  onListSessions: () => Promise<ChatSessionListItem[]>;
  onLoadSession: (sessionId: string) => Promise<boolean>; // Now uses redis_session_id string
  disabled?: boolean;
}

export function ChatHistoryDropdown({ onListSessions, onLoadSession, disabled }: ChatHistoryDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null); // Now string
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [previewMessages, setPreviewMessages] = useState<MessagePreview[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch preview messages on hover with debounce
  const fetchPreview = useCallback(async (sessionId: string) => {
    // Check cache first
    const cached = previewCache.get(sessionId);
    if (cached) {
      setPreviewMessages(cached);
      setIsLoadingPreview(false);
      return;
    }

    setIsLoadingPreview(true);
    try {
      const messages = await getSessionMessages(sessionId);
      console.log(`[ChatHistory] Preview for ${sessionId}: ${messages.length} messages`, messages.slice(-2));
      // Extract last 4 messages with simplified content
      const preview: MessagePreview[] = messages.slice(-4).map(msg => {
        let content = "";
        if (typeof msg.content === "string") {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          // Handle array content (e.g., [{type: 'text', text: '...'}])
          const textPart = msg.content.find((p: any) => p.type === "text");
          content = textPart?.text || "";
        }
        // Truncate long messages
        if (content.length > 150) {
          content = content.substring(0, 147) + "...";
        }
        return { role: msg.role, content };
      });
      previewCache.set(sessionId, preview);
      setPreviewMessages(preview);
    } catch (error) {
      console.error("[ChatHistory] Failed to fetch preview:", error);
      setPreviewMessages([]);
    } finally {
      setIsLoadingPreview(false);
    }
  }, []);

  const handleMouseEnter = useCallback(
    (sessionId: string) => {
      // Clear any pending timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      // Small delay before fetching to avoid rapid fetches
      hoverTimeoutRef.current = setTimeout(() => {
        setHoveredSessionId(sessionId);
        fetchPreview(sessionId);
      }, 150);
    },
    [fetchPreview]
  );

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setHoveredSessionId(null);
    setPreviewMessages([]);
    setIsLoadingPreview(false);
  }, []);

  // Load sessions when dropdown opens
  useEffect(() => {
    if (isOpen) {
      loadSessions();
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const loadSessions = async () => {
    setIsLoading(true);
    try {
      const result = await onListSessions();
      setSessions(result);
      // Debug: show all message keys vs session IDs
      const messageKeys = await debugListMessageKeys();
      console.log(
        "[ChatHistory] Session IDs:",
        result.map(s => s.redis_session_id)
      );
      console.log("[ChatHistory] Message keys:", messageKeys);
    } catch (error) {
      console.error("[ChatHistory] Failed to load sessions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadSession = async (sessionId: string) => {
    console.log(`[ChatHistory] Clicked session ${sessionId}, loading...`);
    setLoadingSessionId(sessionId);
    try {
      const success = await onLoadSession(sessionId);
      console.log(`[ChatHistory] Load result: ${success}`);
      if (success) {
        setIsOpen(false);
      }
    } catch (error) {
      console.error(`[ChatHistory] Error loading session:`, error);
    } finally {
      setLoadingSessionId(null);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!confirm("Delete this chat session?")) return;

    try {
      await deleteLocalSession(sessionId);
      setSessions(prev => prev.filter(s => s.redis_session_id !== sessionId));
      console.log(`[ChatHistory] Deleted session ${sessionId}`);
    } catch (error) {
      console.error("[ChatHistory] Failed to delete session:", error);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Relative time
    let relative: string;
    if (diffMins < 1) relative = "Just now";
    else if (diffMins < 60) relative = `${diffMins}m ago`;
    else if (diffHours < 24) relative = `${diffHours}h ago`;
    else if (diffDays < 7) relative = `${diffDays}d ago`;
    else relative = `${diffDays}d ago`;

    // Precise timestamp
    const precise = date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    return `${relative} · ${precise}`;
  };

  return (
    <div ref={dropdownRef} className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="px-2 h-6 flex items-center justify-center gap-1 border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white shadow-sm text-xs font-medium"
        title="Chat History"
      >
        <History className="size-3" />
        <span>History</span>
      </Button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-96 max-h-80 overflow-y-auto bg-white border border-black rounded-lg shadow-lg z-50 [.theme-inverted_&]:bg-black [.theme-inverted_&]:border-white">
          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="size-4 animate-spin" />
              <span className="ml-2 text-sm">Loading...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500 [.theme-inverted_&]:text-gray-400">
              No previous chats
            </div>
          ) : (
            <Tooltip.Provider delayDuration={200}>
              <div className="py-1">
                {sessions.map(session => (
                  <Tooltip.Root key={session.redis_session_id} open={hoveredSessionId === session.redis_session_id}>
                    <Tooltip.Trigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          console.log(`[ChatHistory] Button clicked for session ${session.redis_session_id}`);
                          handleLoadSession(session.redis_session_id);
                        }}
                        onMouseEnter={() => handleMouseEnter(session.redis_session_id)}
                        onMouseLeave={handleMouseLeave}
                        className="w-full text-left px-3 py-1.5 hover:bg-gray-100 [.theme-inverted_&]:hover:bg-white/10 cursor-pointer flex items-center gap-2 group text-xs"
                      >
                        <span className="truncate flex-1 min-w-0 font-medium">{session.title || "Untitled Chat"}</span>
                        <span className="text-gray-500 [.theme-inverted_&]:text-gray-400 whitespace-nowrap">
                          {session.message_count}msg
                        </span>
                        <span className="text-gray-400 [.theme-inverted_&]:text-gray-500 whitespace-nowrap">
                          {formatDate(session.updated_at)}
                        </span>
                        {loadingSessionId === session.redis_session_id && (
                          <Loader2 className="size-3 animate-spin flex-shrink-0" />
                        )}
                        <span
                          onClick={e => {
                            e.stopPropagation();
                            handleDeleteSession(e, session.redis_session_id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 [.theme-inverted_&]:hover:bg-red-900/30 rounded transition-opacity cursor-pointer flex-shrink-0"
                          title="Delete chat"
                        >
                          <Trash2 className="size-3 text-red-500" />
                        </span>
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        side="left"
                        sideOffset={16}
                        collisionPadding={16}
                        avoidCollisions={true}
                        className="w-96 max-h-[70vh] overflow-hidden flex flex-col bg-gray-50 [.theme-inverted_&]:bg-gray-950 border border-black [.theme-inverted_&]:border-white rounded-xl shadow-2xl z-[100]"
                      >
                        {isLoadingPreview ? (
                          <div className="flex items-center justify-center p-6">
                            <Loader2 className="size-4 animate-spin text-gray-400" />
                            <span className="ml-2 text-xs text-gray-500">Loading...</span>
                          </div>
                        ) : previewMessages.length > 0 ? (
                          <div className="flex flex-col h-full">
                            <div className="px-3 py-2 border-b border-black/10 [.theme-inverted_&]:border-white/10">
                              <span className="text-[10px] font-medium text-gray-500 [.theme-inverted_&]:text-gray-400 uppercase tracking-wide">
                                Recent messages
                              </span>
                            </div>
                            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                              {previewMessages.map((msg, i) => (
                                <div
                                  key={i}
                                  className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
                                >
                                  <div
                                    className={`text-xs px-3 py-2 rounded-2xl max-w-[85%] break-words ${
                                      msg.role === "user"
                                        ? "bg-black text-white [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black"
                                        : "bg-white border border-black [.theme-inverted_&]:bg-black [.theme-inverted_&]:border-white text-gray-900 [.theme-inverted_&]:text-gray-100"
                                    }`}
                                    style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                                  >
                                    {msg.content || "(empty)"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="p-6 text-xs text-gray-400 text-center">No messages</div>
                        )}
                        <Tooltip.Arrow className="fill-gray-50 [.theme-inverted_&]:fill-gray-950" />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                ))}
              </div>
            </Tooltip.Provider>
          )}
        </div>
      )}
    </div>
  );
}
