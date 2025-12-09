import { diffLines } from 'diff';
import React from 'react';
import { preprocessTree } from '@/lib/diff';

interface DiffViewProps {
  oldTree: string;
  newTree: string;
}

type DiffLine = {
  type: 'added' | 'removed' | 'context';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
};

const CONTEXT_LINES = 3;

const DiffView: React.FC<DiffViewProps> = ({ oldTree, newTree }) => {
  const oldStr = preprocessTree(oldTree);
  const newStr = preprocessTree(newTree);

  const differences = diffLines(oldStr, newStr);
  const diffLinesData: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  differences.forEach(part => {
    const lines = part.value.split('\n');
    // The last line is often empty, so we remove it
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }
    
    lines.forEach(line => {
      if (part.added) {
        diffLinesData.push({ type: 'added', newLineNumber: newLine++, content: line });
      } else if (part.removed) {
        diffLinesData.push({ type: 'removed', oldLineNumber: oldLine++, content: line });
      } else {
        diffLinesData.push({ type: 'context', oldLineNumber: oldLine++, newLineNumber: newLine++, content: line });
      }
    });
  });

  const hunks: DiffLine[][] = [];
  let lastHunkEnd = -1;

  for (let i = 0; i < diffLinesData.length; i++) {
    const line = diffLinesData[i];
    if (line.type === 'added' || line.type === 'removed') {
      const hunkStart = Math.max(lastHunkEnd, i - CONTEXT_LINES);
      const hunkEnd = Math.min(diffLinesData.length, i + CONTEXT_LINES + 1);
      
      if (hunkStart > lastHunkEnd + 1) {
        // Add a collapsed section marker
        hunks.push([{ type: 'context', content: '...' }]);
      }
      
      const hunk = diffLinesData.slice(hunkStart, hunkEnd);
      hunks.push(hunk);
      lastHunkEnd = hunkEnd -1;
      i = lastHunkEnd; // Move pointer to end of current hunk
    }
  }

  return (
    <pre className="p-2 text-xs overflow-auto bg-white border rounded-md font-mono text-gray-800">
      {hunks.map((hunk, hunkIndex) => {
        if (hunk.length === 1 && hunk[0].content === '...') {
            return (
                <div key={`hunk-${hunkIndex}`} className="flex bg-gray-100">
                    <span className="w-8 text-right pr-2 select-none text-gray-400">...</span>
                    <span className="w-8 text-right pr-2 select-none text-gray-400">...</span>
                    <span className="flex-1 text-gray-400"></span>
                </div>
            )
        }
        return (
            <div key={`hunk-${hunkIndex}`} className="my-2">
                {hunk.map((line, lineIndex) => {
                    const color = line.type === 'added' ? 'bg-green-100' : line.type === 'removed' ? 'bg-red-100' : 'bg-transparent';
                    const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
                    return (
                        <div key={lineIndex} className={`flex ${color}`}>
                            <span className="w-8 text-right pr-2 select-none text-gray-400">{line.oldLineNumber || ' '}</span>
                            <span className="w-8 text-right pr-2 select-none text-gray-400">{line.newLineNumber || ' '}</span>
                            <span className="w-6 text-left pl-2 select-none">{prefix}</span>
                            <span className="flex-1 whitespace-pre-wrap">{line.content}</span>
                        </div>
                    );
                })}
            </div>
        )
      })}
    </pre>
  );
};

export default DiffView; 