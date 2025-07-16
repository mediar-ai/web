'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, Link2, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
  
  // Manual JSON state
  const [manualJson, setManualJson] = useState('');

  const resetState = () => {
    setSelectedFile(null);
    setFileContent('');
    setGistUrl('');
    setManualJson('');
    setResult(null);
    setUploading(false);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResult(null);
      
      // Read file content
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setFileContent(content);
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

  const validateJson = (jsonStr: string): boolean => {
    try {
      const parsed = JSON.parse(jsonStr);
      return typeof parsed === 'object' && parsed !== null;
    } catch {
      return false;
    }
  };

  const uploadVersion = async () => {
    setUploading(true);
    setResult(null);

    try {
      let automationSequence: string;

      // Get automation sequence based on active tab
      if (activeTab === 'file') {
        if (!fileContent) {
          throw new Error('No file content available');
        }
        automationSequence = fileContent;
      } else if (activeTab === 'gist') {
        if (!gistUrl.trim()) {
          throw new Error('Please enter a GitHub gist URL');
        }
        automationSequence = await fetchGistContent(gistUrl.trim());
      } else if (activeTab === 'manual') {
        if (!manualJson.trim()) {
          throw new Error('Please enter JSON content');
        }
        automationSequence = manualJson.trim();
      } else {
        throw new Error('Invalid upload method');
      }

      // Validate JSON
      if (!validateJson(automationSequence)) {
        throw new Error('Invalid JSON format');
      }

      // Upload to API
      const response = await fetch(`/api/remote-workflows/${workflowId}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          automation_sequence: JSON.parse(automationSequence),
          set_as_active: true,
          description: `Uploaded via UI - ${activeTab === 'file' ? 'File' : activeTab === 'gist' ? 'GitHub Gist' : 'Manual Input'}`
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      setResult({
        success: true,
        message: `Successfully uploaded version ${data.version_number}`,
        version: data.version_number
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

  const isUploadReady = () => {
    if (activeTab === 'file') return fileContent.length > 0;
    if (activeTab === 'gist') return gistUrl.trim().length > 0;
    if (activeTab === 'manual') return manualJson.trim().length > 0;
    return false;
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
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
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
                Manual JSON
              </TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="space-y-4">
              <div>
                <Label htmlFor="file-upload">Select JSON File</Label>
                <Input
                  id="file-upload"
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="mt-1"
                />
                {selectedFile && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
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
                  Enter the URL of a GitHub gist containing your workflow JSON
                </p>
              </div>
            </TabsContent>

            <TabsContent value="manual" className="space-y-4">
              <div>
                <Label htmlFor="manual-json">JSON Content</Label>
                <Textarea
                  id="manual-json"
                  placeholder='{"automation_sequence": [...], "variables": {...}}'
                  value={manualJson}
                  onChange={(e) => setManualJson(e.target.value)}
                  className="mt-1 font-mono text-xs"
                  rows={12}
                />
                <p className="text-sm text-muted-foreground mt-2">
                  Paste your workflow JSON directly here
                </p>
              </div>
            </TabsContent>
          </Tabs>

          {/* Result Display */}
          {result && (
            <Alert className={result.success ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}>
              <div className="flex items-center gap-2">
                {result.success ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600" />
                )}
                <AlertDescription className={result.success ? 'text-green-800' : 'text-red-800'}>
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
                  Upload Version
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
} 