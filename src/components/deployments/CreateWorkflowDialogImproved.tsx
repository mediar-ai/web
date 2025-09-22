'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import * as yaml from 'js-yaml';
import { AlertCircle, CheckCircle, Clock, Copy, Loader2, Zap, Upload, FileArchive, FileCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { YamlEditorWithHighlight } from '@/components/YamlEditorWithHighlight';

interface WorkflowTemplate {
  name: string;
  description: string;
  automation_sequence: string;
  category: string;
  difficulty_level: string;
  estimated_duration_seconds: number;
}

interface CreateWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWorkflowCreated?: (workflow: any) => void;
  initialYaml?: string;
  initialName?: string;
}


export function CreateWorkflowDialog({
  open,
  onOpenChange,
  onWorkflowCreated,
  initialYaml,
  initialName
}: CreateWorkflowDialogProps) {
  const [activeTab, setActiveTab] = useState(initialYaml ? 'manual' : 'template');
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<Record<string, WorkflowTemplate>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [difficultyLevels, setDifficultyLevels] = useState<string[]>([]);

  // ZIP upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadValidation, setUploadValidation] = useState<{
    status: 'idle' | 'validating' | 'valid' | 'invalid';
    message?: string | React.ReactNode;
    workflowData?: any;
  }>({ status: 'idle' });

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [difficulty, setDifficulty] = useState('medium');
  const [estimatedDuration, setEstimatedDuration] = useState(60);
  const [automationSequence, setAutomationSequence] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [dragActive, setDragActive] = useState(false);

  // Load templates when dialog opens and handle initial data
  useEffect(() => {
    if (open) {
      loadTemplates();
      // If we have initial YAML, set it and switch to manual tab
      if (initialYaml) {
        setAutomationSequence(initialYaml);
        setActiveTab('manual');
        if (initialName) {
          setName(initialName + ' (Copy)');
        }
      }
    } else {
      // Reset upload state when dialog closes
      setUploadedFile(null);
      setUploadValidation({ status: 'idle' });
      setDragActive(false);
    }
  }, [open, initialYaml, initialName]);

  const loadTemplates = async () => {
    try {
      const response = await fetch('/api/workflows/create');
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates || {});
        setCategories(data.categories || []);
        setDifficultyLevels(data.difficulty_levels || []);
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
      console.error('Failed to load workflow templates');
    }
  };

  const handleTemplateSelect = (templateKey: string) => {
    const template = templates[templateKey];
    if (template) {
      setSelectedTemplate(templateKey);
      setName(template.name);
      setDescription(template.description);
      setCategory(template.category);
      setDifficulty(template.difficulty_level);
      setEstimatedDuration(template.estimated_duration_seconds);
      setAutomationSequence(template.automation_sequence);
      setActiveTab('manual');
    }
  };

  const addTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleCreate = async () => {
    // For ZIP uploads, check if we have valid workflow data
    if (activeTab === 'upload' && uploadValidation.status !== 'valid') {
      alert('Please upload a valid workflow ZIP file');
      return;
    }

    if (!name.trim() || !automationSequence.trim()) {
      alert('Name and automation sequence are required');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/workflows/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          category,
          difficulty_level: difficulty,
          estimated_duration_seconds: estimatedDuration,
          automation_sequence: automationSequence,
          tags,
          set_as_active: true
        }),
      });

      const result = await response.json();

      if (result.success) {
        alert(`Workflow "${name}" created successfully!`);
        onWorkflowCreated?.(result.workflow);
        onOpenChange(false);
        resetForm();
      } else {
        alert(result.error || 'Failed to create workflow');
      }
    } catch (error) {
      console.error('Error creating workflow:', error);
      alert('Failed to create workflow');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setCategory('general');
    setDifficulty('medium');
    setEstimatedDuration(60);
    setAutomationSequence('');
    setSelectedTemplate(null);
    setTags([]);
    setNewTag('');
    setActiveTab(initialYaml ? 'manual' : 'template');
    setUploadedFile(null);
    setUploadValidation({ status: 'idle' });
    setDragActive(false);
  };

  const copyTemplate = (templateContent: string) => {
    navigator.clipboard.writeText(templateContent);
    console.log('Template copied to clipboard!');
  };

  // ZIP file handling functions
  const handleFileUpload = async (file: File) => {
    setUploadedFile(file);
    setUploadValidation({ status: 'validating', message: 'Validating ZIP file...' });

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/workflows/upload-zip', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        let successMessage: string | React.ReactNode = 'Valid workflow ZIP file';
        if (result.workflowData.referencedFiles && result.workflowData.referencedFiles.length > 0) {
          successMessage = (
            <div className="space-y-1">
              <div>✓ Valid workflow ZIP file</div>
              <div className="text-xs">
                Found {result.workflowData.referencedFiles.length} referenced file(s)
              </div>
            </div>
          );
        }
        setUploadValidation({
          status: 'valid',
          message: successMessage,
          workflowData: result.workflowData,
        });

        // Pre-fill form fields if data is available
        if (result.workflowData) {
          setName(result.workflowData.name || '');
          setDescription(result.workflowData.description || '');
          setAutomationSequence(result.workflowData.yaml || '');
          if (result.workflowData.tags) {
            setTags(result.workflowData.tags);
          }
        }
      } else {
        // Check if there are details about missing files
        let errorMessage = result.error || 'Invalid ZIP file';
        if (result.details?.missingFiles && result.details.missingFiles.length > 0) {
          errorMessage = (
            <div className="space-y-2">
              <div>{result.error}</div>
              <div className="text-xs">
                <div className="font-semibold mb-1">Missing files:</div>
                {result.details.missingFiles.map((file: string) => (
                  <div key={file} className="pl-2 font-mono">• {file}</div>
                ))}
              </div>
              {result.details.availableFiles && result.details.availableFiles.length > 0 && (
                <div className="text-xs mt-2">
                  <div className="font-semibold mb-1">Available JS files in ZIP:</div>
                  {result.details.availableFiles.map((file: string) => (
                    <div key={file} className="pl-2 font-mono text-gray-600">• {file}</div>
                  ))}
                </div>
              )}
            </div>
          );
        }
        setUploadValidation({
          status: 'invalid',
          message: errorMessage,
        });
      }
    } catch (error) {
      console.error('Error validating ZIP:', error);
      setUploadValidation({
        status: 'invalid',
        message: 'Failed to validate ZIP file',
      });
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'application/zip' || file.type === 'application/x-zip-compressed' || file.name.endsWith('.zip')) {
        handleFileUpload(file);
      } else {
        setUploadValidation({
          status: 'invalid',
          message: 'Please upload a ZIP file',
        });
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Create New Workflow
          </DialogTitle>
          <DialogDescription>
            Create a new workflow from scratch using templates or manual YAML definition.
            The workflow will be created with status &quot;deployed&quot; and be immediately available for execution.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="template">Templates</TabsTrigger>
            <TabsTrigger value="manual">Manual Creation</TabsTrigger>
            <TabsTrigger value="upload">Upload ZIP</TabsTrigger>
          </TabsList>

          <TabsContent value="template" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(templates).map(([key, template]) => (
                <Card
                  key={key}
                  className={`cursor-pointer transition-all hover:shadow-md ${selectedTemplate === key ? 'ring-2 ring-blue-500' : ''}`}
                  onClick={() => handleTemplateSelect(key)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{template.name}</CardTitle>
                        <CardDescription className="text-sm mt-1">
                          {template.description}
                        </CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyTemplate(template.automation_sequence);
                        }}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="text-xs">
                        {template.category}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {template.difficulty_level}
                      </Badge>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {template.estimated_duration_seconds}s
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {selectedTemplate && (
              <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-700 mb-2">
                  ✅ Template selected: <strong>{templates[selectedTemplate].name}</strong>
                </p>
                <p className="text-xs text-blue-600">
                  Click &quot;Manual Creation&quot; tab to customize the workflow details.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="manual" className="space-y-4">
            <div className="space-y-6">
              {/* Basic Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                <div className="md:col-span-2">
                  <Label htmlFor="workflow-name">Workflow Name *</Label>
                  <Input
                    id="workflow-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My Awesome Workflow"
                    className="mt-1"
                  />
                </div>

                <div className="md:col-span-2">
                  <Label htmlFor="workflow-description">Description</Label>
                  <Textarea
                    id="workflow-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what this workflow does..."
                    className="mt-1"
                    rows={3}
                  />
                </div>

                  <div>
                    <Label htmlFor="category">Category</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat.replace('_', ' ').toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="difficulty">Difficulty</Label>
                    <Select value={difficulty} onValueChange={setDifficulty}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {difficultyLevels.map((level) => (
                          <SelectItem key={level} value={level}>
                            {level.toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                <div>
                  <Label htmlFor="duration">Estimated Duration (seconds)</Label>
                  <Input
                    id="duration"
                    type="number"
                    value={estimatedDuration}
                    onChange={(e) => setEstimatedDuration(parseInt(e.target.value) || 60)}
                    min={1}
                    className="mt-1"
                  />
                </div>

                {/* Tags */}
                <div className="md:col-span-2">
                  <Label>Tags</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      placeholder="Add tag..."
                      onKeyPress={(e) => e.key === 'Enter' && addTag()}
                      className="flex-1"
                    />
                    <Button onClick={addTag} variant="outline" size="sm">
                      Add
                    </Button>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="cursor-pointer"
                          onClick={() => removeTag(tag)}
                        >
                          {tag} ×
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              {/* Automation Sequence */}
              <div className="space-y-4 w-full">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Automation Sequence (YAML) *</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(automationSequence);
                      alert('YAML copied to clipboard');
                    }}
                    disabled={!automationSequence}
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Copy YAML
                  </Button>
                </div>

                <div className="w-full">
                  <YamlEditorWithHighlight
                    value={automationSequence}
                    onChange={setAutomationSequence}
                    className="w-full"
                    minHeight="400px"
                    placeholder={`---
tool_name: execute_sequence
arguments:
  variables:
    url:
      type: string
      label: Target URL
      default: "https://example.com"

  inputs:
    url: "https://example.com"

  steps:
    - tool_name: navigate_browser
      arguments:
        url: "\${{url}}"

    - tool_name: get_focused_window_tree
      arguments: {}`}
                  />
                </div>

                {/* YAML Validation */}
                {automationSequence && (
                  <div className="mt-4">
                    <YAMLValidator content={automationSequence} />
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ZIP Upload Tab */}
          <TabsContent value="upload" className="space-y-4">
            <div className="space-y-6">
              {/* Upload Zone */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive ? 'border-black bg-gray-50' : 'border-gray-300'
                } ${uploadedFile ? 'bg-gray-50' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  id="zip-upload"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {!uploadedFile ? (
                  <>
                    <FileArchive className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <h3 className="text-lg font-semibold mb-2">Upload Workflow ZIP</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Drop your workflow ZIP file here or click to browse
                    </p>
                    <label htmlFor="zip-upload" className="inline-block cursor-pointer">
                      <div className="inline-flex items-center px-4 py-2 border border-black rounded hover:bg-gray-50 transition-colors">
                        <Upload className="w-4 h-4 mr-2" />
                        <span>Select ZIP File</span>
                      </div>
                    </label>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center gap-3">
                      {uploadValidation.status === 'validating' && (
                        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
                      )}
                      {uploadValidation.status === 'valid' && (
                        <FileCheck className="w-8 h-8 text-green-600" />
                      )}
                      {uploadValidation.status === 'invalid' && (
                        <AlertCircle className="w-8 h-8 text-red-600" />
                      )}
                      <div className="text-left">
                        <p className="font-semibold">{uploadedFile.name}</p>
                        <p className="text-sm text-gray-500">
                          {(uploadedFile.size / 1024).toFixed(2)} KB
                        </p>
                      </div>
                    </div>

                    {uploadValidation.message && (
                      <div className={`text-sm ${
                        uploadValidation.status === 'valid' ? 'text-green-600' :
                        uploadValidation.status === 'invalid' ? 'text-red-600' :
                        'text-gray-600'
                      }`}>
                        {uploadValidation.message}
                      </div>
                    )}

                    <label htmlFor="zip-upload" className="inline-block cursor-pointer">
                      <div className="inline-flex items-center px-3 py-1 text-sm border border-black rounded hover:bg-gray-50 transition-colors">
                        Choose Different File
                      </div>
                    </label>
                  </div>
                )}
              </div>

              {/* Requirements Info */}
              <Card className="border-gray-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">ZIP File Requirements</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Must contain a <code className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">terminator.yml</code> or <code className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">terminator.yaml</code> file</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Can include JavaScript files referenced by <code className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">run_command</code> steps</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>JavaScript files should be in relative paths (e.g., <code className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">./scripts/validate.js</code>)</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                    <span>Maximum file size: 10MB</span>
                  </div>
                </CardContent>
              </Card>

              {/* Extracted Workflow Preview */}
              {uploadValidation.status === 'valid' && uploadValidation.workflowData && (
                <Card className="border-black">
                  <CardHeader>
                    <CardTitle className="text-base">Extracted Workflow</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Name</Label>
                        <Input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Workflow name"
                        />
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Input
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Brief description"
                        />
                      </div>
                    </div>

                    {uploadValidation.workflowData.files && (
                      <div>
                        <Label>Included Files</Label>
                        <div className="mt-2 space-y-1">
                          {uploadValidation.workflowData.files.map((file: string, idx: number) => (
                            <div key={idx} className="text-sm text-gray-600 font-mono">
                              • {file}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex justify-between mt-6">
          <div className="flex items-center gap-2">
            {selectedTemplate && (
              <Badge variant="outline" className="text-xs">
                Using: {templates[selectedTemplate]?.name}
              </Badge>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={loading || !name.trim() || !automationSequence.trim()}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Create Workflow
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * YAML Validation Component
 */
function YAMLValidator({ content }: { content: string }) {
  const [validation, setValidation] = useState<{
    isValid: boolean;
    error?: string;
    hasCron?: boolean;
    cronExpression?: string;
  }>({ isValid: true });

  useEffect(() => {
    if (!content.trim()) {
      setValidation({ isValid: true });
      return;
    }

    try {
      const parsed = yaml.load(content);
      const hasCron = !!(parsed && typeof parsed === 'object' &&
        ((parsed as any).cron || (parsed as any).schedule?.cron));

      const cronExpression = hasCron ?
        ((parsed as any).cron || (parsed as any).schedule?.cron) : undefined;

      setValidation({
        isValid: true,
        hasCron,
        cronExpression
      });
    } catch (error) {
      setValidation({
        isValid: false,
        error: error instanceof Error ? error.message : 'Invalid YAML'
      });
    }
  }, [content]);

  return (
    <div className="flex items-center gap-2">
      {validation.isValid ? (
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle className="w-4 h-4" />
          <span>Valid YAML</span>
          {validation.hasCron && (
            <Badge variant="outline" className="text-xs">
              <Clock className="w-3 h-3 mr-1" />
              Scheduled: {validation.cronExpression}
            </Badge>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-2 text-red-600">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <span className="text-sm break-all">{validation.error}</span>
        </div>
      )}
    </div>
  );
}