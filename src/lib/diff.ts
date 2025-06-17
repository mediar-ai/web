function removeIds(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(removeIds);
  }

  const newObj: Record<string, unknown> = {};
  const
    objAsRecord = obj as Record<string, unknown>;
  for (const key in objAsRecord) {
    if (key !== 'id' && key !== 'element_id') {
      newObj[key] = removeIds(objAsRecord[key]);
    }
  }
  return newObj;
}

export function preprocessTree(jsonString: string): string {
  try {
    const tree = JSON.parse(jsonString);
    const cleanedTree = removeIds(tree);
    return JSON.stringify(cleanedTree, null, 2);
  } catch (error) {
    console.error("Failed to parse or preprocess UI tree:", error);
    return jsonString; // Return original string on error
  }
} 