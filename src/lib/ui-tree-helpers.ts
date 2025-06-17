import { type LowLevelEvent } from "@/types";

type UITreeNode = {
  id: string;
  children?: UITreeNode[];
  attributes?: {
    name?: string;
    label?: string;
  };
  [key: string]: unknown;
};

export type EnrichedEvent = LowLevelEvent & {
  activeUITree?: string;
};

export function processEventsWithUITrees(events: LowLevelEvent[]): EnrichedEvent[] {
  const sortedEvents = [...events].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  
  let lastSeenUITree: string | undefined = undefined;
  
  return sortedEvents.map(event => {
    const enrichedEvent: EnrichedEvent = { ...event };
    const payload = event.payload as { payload?: { type?: string, event?: { screen?: { ui_tree?: string } } } };

    if (payload?.payload?.type === 'ui_tree') {
      lastSeenUITree = payload.payload.event?.screen?.ui_tree;
    }
    
    enrichedEvent.activeUITree = lastSeenUITree;
    return enrichedEvent;
  });
}

function findElementInNode(node: UITreeNode, elementId: string): UITreeNode | null {
    if (node.id === elementId) {
        return node;
    }
    if (node.children) {
        for (const child of node.children) {
            const found = findElementInNode(child, elementId);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

export function findElementLabel(uiTreeString: string, elementId: string): string | null {
    if (!uiTreeString) return null;
    try {
        const tree: UITreeNode = JSON.parse(uiTreeString);
        const element = findElementInNode(tree, elementId);
        return element?.attributes?.name || element?.attributes?.label || null;
    } catch (e) {
        console.error("Error parsing UI tree or finding element:", e);
        return null;
    }
} 