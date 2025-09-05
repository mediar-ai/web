import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createStandardizedParser } from '@/lib/workflow-validation';
import { AlertTriangle, CheckCircle, Copy, Info, XCircle } from 'lucide-react';
import React from 'react';

interface ExecutionFormatInfo {
  hasStandardFormat: boolean;
  outputFormat?: string;
  validation?: {
    errors: string[];
    warnings: string[];
  };
  executionStatus: string;
}

interface WorkflowFormatHelperProps {
  formatInfo?: ExecutionFormatInfo;
  executionResult?: any;
  showAsDialog?: boolean;
}

export function WorkflowFormatHelper({
  formatInfo: _formatInfo,
  executionResult,
  showAsDialog = false,
}: WorkflowFormatHelperProps) {
  const [copiedTemplate, setCopiedTemplate] = React.useState<string | null>(
    null
  );

  const copyTemplate = (type: 'quotes' | 'form' | 'navigation' | 'generic') => {
    const template = createStandardizedParser(type);
    navigator.clipboard.writeText(template);
    setCopiedTemplate(type);
    setTimeout(() => setCopiedTemplate(null), 2000);
  };

  // Try to detect format from execution result
  let detectedFormat: 'standard' | 'legacy' | 'unknown' = 'unknown';
  let parsedOutput: any = null;

  if (executionResult?.formatted_output) {
    try {
      parsedOutput = JSON.parse(executionResult.formatted_output);
      if (
        parsedOutput.success !== undefined &&
        parsedOutput.data !== undefined &&
        parsedOutput.message !== undefined
      ) {
        detectedFormat = 'standard';
      } else {
        detectedFormat = 'legacy';
      }
    } catch {
      detectedFormat = 'legacy';
    }
  }

  const content = (
    <div className="space-y-4">
      {/* Format Status */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Output Format:</span>
        {detectedFormat === 'standard' ? (
          <Badge variant="outline" className="gap-1">
            <CheckCircle className="w-3 h-3" />
            Standardized
          </Badge>
        ) : detectedFormat === 'legacy' ? (
          <Badge variant="secondary" className="gap-1">
            <AlertTriangle className="w-3 h-3" />
            Legacy
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="w-3 h-3" />
            Unknown
          </Badge>
        )}
      </div>

      {/* Format Details */}
      {parsedOutput && detectedFormat === 'standard' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              Standardized Output Detected
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Business Success:</span>
                <span className="font-mono">
                  {String(parsedOutput.success)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Message:</span>
                <span
                  className="truncate max-w-[200px]"
                  title={parsedOutput.message}
                >
                  {parsedOutput.message}
                </span>
              </div>
              {parsedOutput.validation && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Validation Checks:
                  </span>
                  <span className="font-mono">
                    {Object.keys(parsedOutput.validation).length}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legacy Format Warning */}
      {detectedFormat === 'legacy' && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Legacy Output Format</AlertTitle>
          <AlertDescription>
            This workflow uses the legacy output format. Consider updating to
            the standardized format for better error handling and consistency.
          </AlertDescription>
        </Alert>
      )}

      {/* Template Examples */}
      {detectedFormat !== 'standard' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Standardized Parser Templates
            </CardTitle>
            <CardDescription className="text-xs">
              Copy a template to upgrade your workflow
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyTemplate('quotes')}
                className="justify-start"
              >
                <Copy className="w-3 h-3 mr-2" />
                {copiedTemplate === 'quotes' ? 'Copied!' : 'Quote Parser'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyTemplate('form')}
                className="justify-start"
              >
                <Copy className="w-3 h-3 mr-2" />
                {copiedTemplate === 'form' ? 'Copied!' : 'Form Parser'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyTemplate('navigation')}
                className="justify-start"
              >
                <Copy className="w-3 h-3 mr-2" />
                {copiedTemplate === 'navigation'
                  ? 'Copied!'
                  : 'Navigation Parser'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyTemplate('generic')}
                className="justify-start"
              >
                <Copy className="w-3 h-3 mr-2" />
                {copiedTemplate === 'generic' ? 'Copied!' : 'Generic Parser'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Format Documentation */}
      <div className="text-xs text-muted-foreground">
        <div className="flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5" />
          <div>
            <p>Standardized parsers return:</p>
            <code className="block mt-1 p-2 bg-muted rounded text-[10px]">
              {`{
  success: boolean,  // Business success
  data: any,         // Extracted data
  message: string,   // User message
  error: string?,    // Error details
  validation: {}     // Checks performed
}`}
            </code>
          </div>
        </div>
      </div>
    </div>
  );

  if (showAsDialog) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            <Info className="w-3 h-3" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Workflow Output Format</DialogTitle>
            <DialogDescription>
              Information about the workflow&apos;s output parser format
            </DialogDescription>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    );
  }

  return content;
}
