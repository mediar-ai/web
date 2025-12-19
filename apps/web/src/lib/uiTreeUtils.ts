// src/lib/uiTreeUtils.ts

export type UITreeNode = {
  id: string;
  attributes: {
    role: string;
    name?: string;
    [key: string]: unknown; // Allow other attributes
  };
  children?: UITreeNode[];
};

const Roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", 
               "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
               "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX"];

const buildSimplifiedNodeString = (node: UITreeNode, level = 1, lineCounter = { count: 1 }): string[] => {
  const output: string[] = [];
  const { role, name, ...otherAttributes } = node.attributes;
  
  let attributesString = '';
  // Include only a few common and potentially useful attributes for LLM context
  const relevantAttributes: { [key: string]: unknown } = {};
  if (otherAttributes.value !== undefined) relevantAttributes.value = otherAttributes.value;
  if (otherAttributes.checked !== undefined) relevantAttributes.checked = otherAttributes.checked;
  if (otherAttributes.selected !== undefined) relevantAttributes.selected = otherAttributes.selected;
  if (otherAttributes.url !== undefined && typeof otherAttributes.url === 'string' && otherAttributes.url.length < 100) {
    relevantAttributes.url = otherAttributes.url; // Keep URLs short
  }

  if (Object.keys(relevantAttributes).length > 0) {
    attributesString = Object.entries(relevantAttributes)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(', ');
  }

  const romanLevel = Roman[level] || level.toString();
  let line = `${lineCounter.count++}. ${romanLevel}. [${role}]`;
  if (name) {
    line += ` '${name}'`;
  }
  if (attributesString) {
    line += ` {${attributesString}}`;
  }
  output.push(line);

  if (node.children) {
    node.children.forEach(child => {
      output.push(...buildSimplifiedNodeString(child, level + 1, lineCounter));
    });
  }
  
  return output;
};

export const generateSimplifiedUiTreeString = (treeString: string | null | undefined): string | null => {
  if (!treeString) {
    return null;
  }

  const trimmed = treeString.trim();

  // Check if it's already in CompactYaml format (starts with "- [" which is the tree text format)
  // CompactYaml format: "- [Window] name (attributes)\n  - [Pane] ..."
  if (trimmed.startsWith('- [') || trimmed.startsWith('#')) {
    // Already in simplified text format, return as-is
    console.log('[uiTreeUtils] CompactYaml format detected, returning as-is');
    return treeString;
  }

  // Try to parse as JSON (legacy format)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const tree: UITreeNode = JSON.parse(treeString);
      const stringArray = buildSimplifiedNodeString(tree, 1, { count: 1 });
      return stringArray.join('\n');
    } catch (error) {
      console.error("[uiTreeUtils] Error parsing JSON UI Tree:", error);
      return "Error parsing UI Tree.";
    }
  }

  // Unknown format, return as-is
  console.log('[uiTreeUtils] Unknown format, returning as-is');
  return treeString;
};
