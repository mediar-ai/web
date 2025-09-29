'use client';

import { useState, useEffect } from 'react';
import { AlertCircle, RefreshCw, CheckCircle, XCircle, Info } from 'lucide-react';

interface ErrorAnalysisProps {
  executionId: string;
  workflowId: string;
  error: any;
  logs?: string;
  results?: any;
  existingAnalysis?: string;
  onAnalysisComplete?: (analysis: string) => void;
}

export function ErrorAnalysisDisplay({
  executionId,
  workflowId,
  error,
  logs,
  results,
  existingAnalysis,
  onAnalysisComplete,
}: ErrorAnalysisProps) {
  const [analysis, setAnalysis] = useState<string>(existingAnalysis || '');
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!existingAnalysis && executionId && error) {
      // Auto-analyze on mount if no existing analysis
      analyzeError();
    }
  }, [executionId]);

  const analyzeError = async () => {
    setLoading(true);
    setRetrying(false);

    try {
      const response = await fetch('/api/internal/analyze-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executionId,
          workflowId,
          error,
          logs,
          results,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setAnalysis(data.analysis);
        onAnalysisComplete?.(data.analysis);
      } else {
        throw new Error(data.error || 'Analysis failed');
      }
    } catch (error) {
      console.error('Error analysis failed:', error);
      setAnalysis('Failed to generate error analysis. Please review logs manually.');
    } finally {
      setLoading(false);
    }
  };

  const retryAnalysis = () => {
    setRetrying(true);
    analyzeError();
  };

  const formatAnalysis = (text: string) => {
    // Parse markdown-style formatting
    const sections = text.split(/\n(?=\*\*)/);
    return sections.map((section, idx) => {
      if (section.startsWith('**Root Cause')) {
        return (
          <div key={idx} className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="h-5 w-5 text-red-600" />
              <h4 className="font-semibold text-red-900">Root Cause</h4>
            </div>
            <p className="text-sm text-red-800">{section.replace(/\*\*Root Cause[:\s]*/i, '').replace(/\*\*/g, '')}</p>
          </div>
        );
      } else if (section.includes('Solution') || section.includes('Fix')) {
        return (
          <div key={idx} className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <h4 className="font-semibold text-green-900">Solution</h4>
            </div>
            <div className="text-sm text-green-800 whitespace-pre-wrap">
              {section.replace(/\*\*Solution[:\s]*/i, '').replace(/\*\*/g, '')}
            </div>
          </div>
        );
      } else if (section.includes('Prevention')) {
        return (
          <div key={idx} className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Info className="h-5 w-5 text-blue-600" />
              <h4 className="font-semibold text-blue-900">Prevention</h4>
            </div>
            <div className="text-sm text-blue-800 whitespace-pre-wrap">
              {section.replace(/\*\*Prevention[:\s]*/i, '').replace(/\*\*/g, '')}
            </div>
          </div>
        );
      } else if (section.trim()) {
        return (
          <div key={idx} className="mb-3 text-sm text-gray-700 whitespace-pre-wrap">
            {section.replace(/\*\*/g, '')}
          </div>
        );
      }
      return null;
    });
  };

  if (loading) {
    return (
      <div className="p-6 bg-gray-50 rounded-lg animate-pulse">
        <div className="flex items-center gap-3">
          <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />
          <span className="text-gray-600">Analyzing error with AI...</span>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            <span className="text-yellow-800">No error analysis available</span>
          </div>
          <button
            onClick={analyzeError}
            className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
          >
            Generate Analysis
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">AI Error Analysis</h3>
        <button
          onClick={retryAnalysis}
          className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          title="Regenerate analysis"
        >
          <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        {formatAnalysis(analysis)}
      </div>

      {/* Quick Actions based on analysis */}
      {analysis.includes('MCP connection') && (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800 mb-2">
            <strong>Quick Fix:</strong> The MCP server appears to be down.
          </p>
          <div className="flex gap-2">
            <a
              href="/settings/machines"
              className="text-xs px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700"
            >
              Check Machine Status
            </a>
            <button
              onClick={() => window.open('https://portal.azure.com', '_blank')}
              className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Open Azure Portal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Standalone function to trigger analysis for failed executions
export async function triggerErrorAnalysis(executionId: string, workflowId: string) {
  try {
    const response = await fetch('/api/internal/analyze-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executionId, workflowId }),
    });

    return await response.json();
  } catch (error) {
    console.error('Failed to trigger error analysis:', error);
    return null;
  }
}