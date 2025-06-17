import React from 'react';

type UITreeNode = {
  id: string;
  attributes: {
    role: string;
    name?: string;
    [key: string]: unknown;
  };
  children?: UITreeNode[];
};

interface FormattedUITreeProps {
  treeString: string;
}

const Roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", 
               "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
               "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX"];

const renderNode = (node: UITreeNode, level = 1, line = { count: 1 }): React.ReactNode[] => {
  const output: React.ReactNode[] = [];
  
  const { role, name, ...otherAttributes } = node.attributes;
  let attributesString = '';
  if (Object.keys(otherAttributes).length > 0) {
      attributesString = Object.entries(otherAttributes)
          .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
          .join(', ');
  }

  output.push(
    <div key={node.id} className="flex items-start">
      <span className="w-8 text-right pr-2 text-gray-400">{line.count++}</span>
      <span className="w-12 pr-2 text-gray-500">{Roman[level] || level}</span>
      <span className="flex-1">
        <span className="font-bold">[{role}]</span> {name && `'${name}'`} {attributesString && <span className="text-gray-500">[{attributesString}]</span>}
      </span>
    </div>
  );

  if (node.children) {
    node.children.forEach(child => {
      output.push(...renderNode(child, level + 1, line));
    });
  }
  
  return output;
};


const FormattedUITree: React.FC<FormattedUITreeProps> = ({ treeString }) => {
  try {
    const tree: UITreeNode = JSON.parse(treeString);
    return <pre className="p-2 text-xs overflow-auto bg-white border rounded-md font-mono text-gray-800">{renderNode(tree)}</pre>;
  } catch {
    return <div className="text-red-500">Error parsing UI Tree.</div>;
  }
};

export default FormattedUITree; 