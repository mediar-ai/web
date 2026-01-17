/**
 * Workflow Suggestions
 *
 * Provides default suggested actions for the chat UI.
 * Note: AI-powered suggestion generation was removed (YAML workflows deprecated).
 */

export interface SuggestedAction {
  id: string;
  title: string;
  description: string;
  icon: "play" | "edit" | "zap" | "message" | "sparkles";
  prompt: string;
}

/**
 * Default fallback suggestions (when workflow is open)
 */
const FALLBACK_SUGGESTIONS: SuggestedAction[] = [
  {
    id: "explain-workflow",
    title: "Explain workflow",
    description: "Understand the entire workflow structure and entry point",
    icon: "message",
    prompt: "Explain the entire workflow to me, where is the entry point, how do all the files work together?",
  },
  {
    id: "demo-search",
    title: "Demo: Search Mediar",
    description: "Navigate to Google and search for mediar.ai",
    icon: "play",
    prompt:
      "Navigate to google.com and search mediar.ai in search bar, and click on the mediar.ai from the search results",
  },
];

/**
 * Homepage quick actions (when no workflow is open and chat is empty)
 */
const HOMEPAGE_QUICK_ACTIONS: SuggestedAction[] = [
  {
    id: "open-chrome",
    title: "Open Chrome",
    description: "Launch Google Chrome browser",
    icon: "play",
    prompt: "Open Chrome",
  },
  {
    id: "search-google",
    title: "Search Google",
    description: "Open Chrome and search on Google",
    icon: "zap",
    prompt: "Open Chrome and search for 'AI automation tools' on Google",
  },
  {
    id: "take-screenshot",
    title: "Take Screenshot",
    description: "Capture a screenshot of the current screen",
    icon: "sparkles",
    prompt: "Take a screenshot of my screen",
  },
  {
    id: "help",
    title: "What can you do?",
    description: "Learn about Mediar's capabilities",
    icon: "message",
    prompt: "What can you help me with? Give me some examples of tasks you can automate.",
  },
];

/**
 * Get fallback suggestions for the chat UI
 */
export function getFallbackSuggestions(): SuggestedAction[] {
  return FALLBACK_SUGGESTIONS;
}

/**
 * Get homepage quick actions for empty chat state
 */
export function getHomepageQuickActions(): SuggestedAction[] {
  return HOMEPAGE_QUICK_ACTIONS;
}
