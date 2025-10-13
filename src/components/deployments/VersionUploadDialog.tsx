'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import * as yaml from 'js-yaml';
import { AlertCircle, AlertTriangle, CheckCircle, Link2, Loader2, Upload } from 'lucide-react';
import React, { useState } from 'react';

interface VersionUploadDialogProps {
  workflowId: number;
  workflowName: string;
  children: React.ReactNode;
  onUploadSuccess?: () => void;
}

interface UploadResult {
  success: boolean;
  message: string;
  version?: string;
  error?: string;
}

type ContentFormat = 'json' | 'yaml' | 'unknown';

export function VersionUploadDialog({ 
  workflowId, 
  workflowName, 
  children, 
  onUploadSuccess 
}: VersionUploadDialogProps) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [activeTab, setActiveTab] = useState('file');
  
  // File upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  
  // GitHub gist state
  const [gistUrl, setGistUrl] = useState('');
  
  // Manual content state
  const [manualContent, setManualContent] = useState('');
  
  // Activation control
  const [activateImmediately, setActivateImmediately] = useState(false);
  
  // Format detection state
  const [detectedFormat, setDetectedFormat] = useState<ContentFormat>('unknown');

  const resetState = () => {
    setSelectedFile(null);
    setFileContent('');
    setGistUrl('');
    setManualContent('');
    setResult(null);
    setUploading(false);
    setActivateImmediately(false);
    setDetectedFormat('unknown');
  };

  // Enhanced format detection
  const detectContentFormat = (content: string): ContentFormat => {
    if (!content.trim()) return 'unknown';
    
    const trimmed = content.trim();
    
    // JSON detection - starts with { or [
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {
        return 'unknown';
      }
    }
    
    // YAML detection - common YAML patterns
    if (trimmed.includes('tool_name:') || 
        trimmed.includes('arguments:') || 
        /^[a-zA-Z_][a-zA-Z0-9_]*:\s*$/m.test(trimmed) ||
        /^[\s]*-\s+/.test(trimmed)) {
      return 'yaml';
    }
    
    return 'unknown';
  };

  // Validate content based on format
  const validateContent = async (content: string, format: ContentFormat): Promise<{ isValid: boolean; error?: string }> => {
    if (!content.trim()) {
      return { isValid: false, error: 'Content is empty' };
    }

    try {
      if (format === 'json') {
        const parsed = JSON.parse(content);
        if (typeof parsed !== 'object' || parsed === null) {
          return { isValid: false, error: 'JSON must be an object or array' };
        }
        return { isValid: true };
      } else if (format === 'yaml') {
        const parsed = yaml.load(content);
        if (typeof parsed !== 'object' || parsed === null) {
          return { isValid: false, error: 'YAML must represent an object or array' };
        }
        return { isValid: true };
      } else {
        return { isValid: false, error: 'Unrecognized format. Please use valid JSON or YAML.' };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Parse error';
      return { isValid: false, error: `Invalid ${format}: ${errorMsg}` };
    }
  };

  // Update content and detect format
  const updateContentAndFormat = (content: string) => {
    const format = detectContentFormat(content);
    setDetectedFormat(format);
    return format;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validation 1: File size check (5MB max for JSON/YAML)
      const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
      if (file.size > MAX_FILE_SIZE) {
        setResult({
          success: false,
          message: 'File size exceeds 5MB limit',
          error: `File is ${(file.size / 1024 / 1024).toFixed(2)}MB. Maximum allowed size is 5MB.`
        });
        return;
      }

      // Validation 2: MIME type and extension check
      const ALLOWED_MIME_TYPES = [
        'application/json',
        'application/x-yaml',
        'text/yaml',
        'text/x-yaml',
        'application/yaml',
        'text/plain' // Some systems report YAML as text/plain
      ];

      const ALLOWED_EXTENSIONS = ['.json', '.yml', '.yaml'];
      const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

      // Validate MIME type (if browser provides it)
      if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
        setResult({
          success: false,
          message: 'Invalid file type',
          error: `File type "${file.type}" not allowed. Please upload JSON or YAML files.`
        });
        return;
      }

      // Validate extension
      if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
        setResult({
          success: false,
          message: 'Invalid file extension',
          error: `Extension "${fileExtension}" not allowed. Allowed: .json, .yml, .yaml`
        });
        return;
      }

      setSelectedFile(file);
      setResult(null);

      // Read file content
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setFileContent(content);
        updateContentAndFormat(content);
      };
      reader.readAsText(file);
    }
  };

  const fetchGistContent = async (url: string): Promise<string> => {
    // Convert GitHub gist URL to raw content URL
    // https://gist.github.com/user/gist_id -> https://gist.githubusercontent.com/user/gist_id/raw
    const gistMatch = url.match(/gist\.github\.com\/([^\/]+)\/([a-f0-9]+)/);
    if (!gistMatch) {
      throw new Error('Invalid GitHub gist URL format');
    }
    
    const [, user, gistId] = gistMatch;
    const rawUrl = `https://gist.githubusercontent.com/${user}/${gistId}/raw`;
    
    const response = await fetch(rawUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch gist: ${response.statusText}`);
    }
    
    return response.text();
  };

  const uploadVersion = async () => {
    setUploading(true);
    setResult(null);

    try {
      let content: string;
      let sourceDescription: string;

      // Get content based on active tab
      if (activeTab === 'file') {
        if (!fileContent) {
          throw new Error('No file content available');
        }
        content = fileContent;
        sourceDescription = 'File Upload';
      } else if (activeTab === 'gist') {
        if (!gistUrl.trim()) {
          throw new Error('Please enter a GitHub gist URL');
        }
        content = await fetchGistContent(gistUrl.trim());
        updateContentAndFormat(content);
        sourceDescription = 'GitHub Gist';
      } else if (activeTab === 'manual') {
        if (!manualContent.trim()) {
          throw new Error('Please enter content');
        }
        content = manualContent.trim();
        sourceDescription = 'Manual Input';
      } else {
        throw new Error('Invalid upload method');
      }

      // Detect and validate format
      const format = detectContentFormat(content);
      const validation = await validateContent(content, format);
      
      if (!validation.isValid) {
        throw new Error(validation.error || 'Content validation failed');
      }

      // Prepare automation sequence for API
      let automationSequence: object | string;
      if (format === 'json') {
        automationSequence = JSON.parse(content);
      } else if (format === 'yaml') {
        // Send as string - API will handle YAML conversion
        automationSequence = content;
      } else {
        throw new Error('Unsupported content format');
      }

      // Upload to API
      const response = await fetch(`/api/remote-workflows/${workflowId}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          automation_sequence: automationSequence,
          set_as_active: activateImmediately,
          change_notes: `Uploaded via UI - ${sourceDescription} (${format.toUpperCase()} format)`
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      setResult({
        success: true,
        message: `Successfully uploaded version ${data.version.version_number}${activateImmediately ? ' and activated' : ''}`,
        version: data.version.version_number
      });

      // Call success callback
      if (onUploadSuccess) {
        onUploadSuccess();
      }

      // Auto-close after 2 seconds on success
      setTimeout(() => {
        setOpen(false);
        resetState();
      }, 2000);

    } catch (error) {
      console.error('Upload failed:', error);
      setResult({
        success: false,
        message: 'Upload failed',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    } finally {
      setUploading(false);
    }
  };

  const getCurrentContent = () => {
    if (activeTab === 'file') return fileContent;
    if (activeTab === 'gist') return ''; // Content fetched on upload
    if (activeTab === 'manual') return manualContent;
    return '';
  };

  const isUploadReady = () => {
    if (activeTab === 'file') return fileContent.length > 0;
    if (activeTab === 'gist') return gistUrl.trim().length > 0;
    if (activeTab === 'manual') return manualContent.trim().length > 0;
    return false;
  };

  const showFormatBadge = () => {
    const content = getCurrentContent();
    if (!content && activeTab !== 'gist') return null;
    
    const format = detectedFormat;
    if (format === 'unknown') return null;

    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="px-2 py-1 rounded-full bg-black text-white border border-black">
          {format.toUpperCase()} Format
        </span>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      setOpen(newOpen);
      if (!newOpen) {
        resetState();
      }
    }}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload New Version - {workflowName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="file" className="flex items-center gap-2">
                <Upload className="w-4 h-4" />
                File Upload
              </TabsTrigger>
              <TabsTrigger value="gist" className="flex items-center gap-2">
                <Link2 className="w-4 h-4" />
                GitHub Gist
              </TabsTrigger>
              <TabsTrigger value="manual" className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Manual Input
              </TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="space-y-4">
              <div>
                <Label htmlFor="file-upload">Select JSON or YAML File</Label>
                <Input
                  id="file-upload"
                  type="file"
                  accept=".json,.yml,.yaml"
                  onChange={handleFileSelect}
                  className="mt-1"
                />
                {selectedFile && (
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-sm text-muted-foreground">
                      Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                    </p>
                    {showFormatBadge()}
                  </div>
                )}
              </div>
              
              {fileContent && (
                <div>
                  <Label>Preview (first 500 characters)</Label>
                  <Textarea
                    value={fileContent.substring(0, 500) + (fileContent.length > 500 ? '...' : '')}
                    readOnly
                    className="mt-1 font-mono text-xs"
                    rows={8}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="gist" className="space-y-4">
              <div>
                <Label htmlFor="gist-url">GitHub Gist URL</Label>
                <Input
                  id="gist-url"
                  type="url"
                  placeholder="https://gist.github.com/username/gist_id"
                  value={gistUrl}
                  onChange={(e) => setGistUrl(e.target.value)}
                  className="mt-1"
                />
                <p className="text-sm text-muted-foreground mt-2">
                  Enter the URL of a GitHub gist containing your workflow JSON or YAML
                </p>
              </div>
            </TabsContent>

            <TabsContent value="manual" className="space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="manual-content">JSON or YAML Content</Label>
                  {showFormatBadge()}
                </div>
                <Textarea
                  id="manual-content"
                  placeholder='JSON: {"automation_sequence": [...], "variables": {...}}
YAML:
tool_name: workflow_name
arguments:
  variables: {...}
  inputs: {...}'
                  value={manualContent}
                  onChange={(e) => {
                    setManualContent(e.target.value);
                    updateContentAndFormat(e.target.value);
                  }}
                  className="mt-1 font-mono text-xs"
                  rows={12}
                />
                <p className="text-sm text-muted-foreground mt-2">
                  Paste your workflow JSON or YAML directly here
                </p>
              </div>
            </TabsContent>
          </Tabs>

          {/* Activation Control */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="activate-immediately"
                checked={activateImmediately}
                onCheckedChange={(checked) => setActivateImmediately(checked as boolean)}
              />
              <Label htmlFor="activate-immediately" className="text-sm font-medium">
                Activate this version immediately after upload
              </Label>
            </div>
            
            {activateImmediately ? (
              <Alert className="border-black bg-gray-50">
                <AlertTriangle className="h-4 w-4 text-black" />
                <AlertDescription className="text-black">
                  <div className="font-medium">[WARN] Production Impact Warning</div>
                  <p className="text-sm mt-1">
                    Activating immediately will switch all new workflow executions to use this version. 
                    Existing running executions will continue with their current version.
                  </p>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="border-black bg-white">
                <CheckCircle className="h-4 w-4 text-black" />
                <AlertDescription className="text-black">
                  <div className="font-medium">[SUCCESS] Safe Upload Mode</div>
                  <p className="text-sm mt-1">
                    Version will be created but not activated. You can test and activate it later when ready.
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Result Display */}
          {result && (
            <Alert className={result.success ? 'border-black bg-white' : 'border-black bg-gray-50'}>
              <div className="flex items-center gap-2">
                {result.success ? (
                  <CheckCircle className="w-4 h-4 text-black" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-black" />
                )}
                <AlertDescription className="text-black">
                  <div>
                    <p className="font-medium">{result.message}</p>
                    {result.version && (
                      <p className="text-sm mt-1">New version: {result.version}</p>
                    )}
                    {result.error && (
                      <p className="text-sm mt-1">Error: {result.error}</p>
                    )}
                  </div>
                </AlertDescription>
              </div>
            </Alert>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button 
              onClick={uploadVersion} 
              disabled={!isUploadReady() || uploading}
              className="flex items-center gap-2"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  {activateImmediately ? 'Upload & Activate' : 'Upload Version'}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
} 