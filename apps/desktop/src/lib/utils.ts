import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Recursively find a tree field (ui_tree or browser_dom) in an object
 */
function findTreeField(obj: unknown, fieldName: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;

  // Check if this object has the field
  if (fieldName in obj) {
    const tree = (obj as Record<string, unknown>)[fieldName];
    if (typeof tree === "string") return tree;
  }

  // Search in arrays
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findTreeField(item, fieldName);
      if (found) return found;
    }
  }

  // Search in object properties
  for (const value of Object.values(obj)) {
    const found = findTreeField(value, fieldName);
    if (found) return found;
  }

  return undefined;
}

/**
 * Extract images from tool result (_images field or MCP image content)
 */
function extractImages(obj: unknown): Array<{ data: string; mimeType: string }> {
  if (!obj || typeof obj !== "object") return [];

  const images: Array<{ data: string; mimeType: string }> = [];

  // Check for _images field (from useWebAppChat image extraction)
  if ("_images" in obj && Array.isArray((obj as any)._images)) {
    for (const img of (obj as any)._images) {
      if (img.data) {
        images.push({ data: img.data, mimeType: img.mimeType || "image/png" });
      }
    }
  }

  // Check for MCP content array with type: "image"
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item?.type === "image" && item?.data) {
        images.push({ data: item.data, mimeType: item.mimeType || "image/png" });
      }
      // Recurse into array items
      images.push(...extractImages(item));
    }
  }

  // Check for content array in object
  if ("content" in obj && Array.isArray((obj as any).content)) {
    for (const item of (obj as any).content) {
      if (item?.type === "image" && item?.data) {
        images.push({ data: item.data, mimeType: item.mimeType || "image/png" });
      }
    }
  }

  return images;
}

/**
 * Recursively parse stringified JSON fields for better display
 */
function deepParseJsonStrings(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    // Try to parse if it looks like JSON
    const trimmed = obj.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed);
        return deepParseJsonStrings(parsed);
      } catch {
        return obj;
      }
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(deepParseJsonStrings);
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepParseJsonStrings(value);
    }
    return result;
  }

  return obj;
}

/**
 * Format a result object for display, handling tree fields specially to preserve newlines
 */
export function formatResultForDisplay(result: unknown): {
  json: string;
  content?: string;
  uiTree?: string;
  browserDom?: string;
  ocrTree?: string;
  omniparserTree?: string;
  uiDiff?: string;
  images?: Array<{ data: string; mimeType: string }>;
} {
  const content = findTreeField(result, "content");
  const uiTree = findTreeField(result, "ui_tree");
  const browserDom = findTreeField(result, "browser_dom");
  const ocrTree = findTreeField(result, "ocr_tree");
  const omniparserTree = findTreeField(result, "omniparser_tree");
  const uiDiff = findTreeField(result, "ui_diff");
  const images = extractImages(result);

  // Deep parse any stringified JSON for better formatting
  const parsedResult = deepParseJsonStrings(result);

  return {
    json: JSON.stringify(parsedResult, null, 2),
    content,
    uiTree,
    browserDom,
    ocrTree,
    omniparserTree,
    uiDiff,
    images: images.length > 0 ? images : undefined,
  };
}
