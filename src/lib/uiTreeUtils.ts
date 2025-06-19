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
  try {
    const tree: UITreeNode = JSON.parse(treeString);
    const stringArray = buildSimplifiedNodeString(tree, 1, { count: 1 }); // Initialize counter here
    return stringArray.join('\n');
  } catch (error) {
    console.error("Error parsing or simplifying UI Tree:", error);
    // For LLM context, it might be better to return a note about the error 
    // or the raw string if it's not too large, rather than null.
    // However, for now, returning null to indicate failure.
    return "Error parsing UI Tree."; 
  }
};
