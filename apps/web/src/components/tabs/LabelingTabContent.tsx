'use client';

import { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, WrapText, Text } from 'lucide-react';

// Mock Data
const mockData = [
  {
    id: 1,
    timestamp: new Date('2025-06-17T12:10:26Z'),
    contextSummary: { windowTitle: 'Find Computers', eventCount: 5 },
    llmOutput: 'Searched for available computers in the asset management system.',
    potentialWorkflows: [],
    userSelection: null,
  },
  {
    id: 2,
    timestamp: new Date('2025-06-17T12:11:05Z'),
    contextSummary: { windowTitle: 'Computer Details: COMP-123', eventCount: 8 },
    llmOutput: 'Viewed details for computer COMP-123.',
    potentialWorkflows: ['Asset Retirement', 'Software Audit'],
    userSelection: 'Asset Retirement',
  },
  {
    id: 3,
    timestamp: new Date('2025-06-17T12:11:45Z'),
    contextSummary: { windowTitle: 'Edit Computer: COMP-123', eventCount: 12 },
    llmOutput: 'Changed status of COMP-123 to "Pending Decommission".',
    potentialWorkflows: ['Asset Retirement', 'Hardware Upgrade'],
    userSelection: 'Asset Retirement',
  },
];

type SortKey = 'timestamp' | 'contextSummary' | 'llmOutput';

export default function LabelingTabContent() {
  const [data, ] = useState(mockData);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(null);
  const [isWrapped, setIsWrapped] = useState(true);

  const filteredData = useMemo(() => {
    let searchableData = [...data];

    if (searchTerm) {
      searchableData = searchableData.filter(item =>
        Object.values(item).some(value =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    }

    if (sortConfig !== null) {
      searchableData.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    return searchableData;
  }, [data, searchTerm, sortConfig]);

  const requestSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };
  
  const getSortIndicator = (key: SortKey) => {
    if (!sortConfig || sortConfig.key !== key) {
      return <ArrowUpDown className="h-4 w-4" />;
    }
    return sortConfig.direction === 'asc' ? '▲' : '▼';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end mb-4">
        <div className="flex items-center space-x-2">
            <Input
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
            />
            <Button variant="outline" onClick={() => setIsWrapped(!isWrapped)}>
                {isWrapped ? <Text className="h-4 w-4 mr-2" /> : <WrapText className="h-4 w-4 mr-2" />}
                {isWrapped ? 'Unwrap Content' : 'Wrap Content'}
            </Button>
        </div>
      </div>
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead onClick={() => requestSort('timestamp')} className="cursor-pointer">
                <div className="flex items-center">
                  Timestamp {getSortIndicator('timestamp')}
                </div>
              </TableHead>
              <TableHead onClick={() => requestSort('contextSummary')} className="cursor-pointer">
                 <div className="flex items-center">
                  Context Summary {getSortIndicator('contextSummary')}
                </div>
              </TableHead>
              <TableHead onClick={() => requestSort('llmOutput')} className="cursor-pointer">
                 <div className="flex items-center">
                  LLM Output {getSortIndicator('llmOutput')}
                </div>
              </TableHead>
              <TableHead>List of potential workflows</TableHead>
              <TableHead>User selection</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.map((item) => (
              <TableRow key={item.id}>
                <TableCell className={isWrapped ? 'whitespace-nowrap' : ''}>
                  {item.timestamp.toLocaleString()}
                </TableCell>
                <TableCell className={isWrapped ? 'max-w-xs truncate' : ''}>
                  <strong>{item.contextSummary.windowTitle}</strong> ({item.contextSummary.eventCount} events)
                </TableCell>
                <TableCell className={isWrapped ? 'max-w-xs truncate' : ''}>
                  {item.llmOutput}
                </TableCell>
                <TableCell>
                  {/* Placeholder */}
                </TableCell>
                <TableCell>
                  {/* Placeholder for dropdown */}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
} 