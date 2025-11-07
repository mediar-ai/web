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
import { AlertCircle, CheckCircle, Clock, Copy, Loader2, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CronScheduleEditor, type CronConfig } from './CronScheduleEditor';
import { toast } from 'sonner';

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
}

export function CreateWorkflowDialog({
  open,
  onOpenChange,
  onWorkflowCreated
}: CreateWorkflowDialogProps) {
  const [activeTab, setActiveTab] = useState('template');
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<Record<string, WorkflowTemplate>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [difficultyLevels, setDifficultyLevels] = useState<string[]>([]);
  
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

  // Cron schedule state
  const [cronConfig, setCronConfig] = useState<CronConfig>({
    expression: '',
    timezone: 'UTC',
    enabled: false,
    maxConcurrent: 1,
    retryOnFailure: true,
    retryCount: 3,
  });

  // Load templates when dialog opens
  useEffect(() => {
    if (open) {
      loadTemplates();
    }
  }, [open]);

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
      // Stay on template tab - don't switch tabs automatically
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
    if (!name.trim() || !automationSequence.trim()) {
      toast.error('Name and automation sequence are required');
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
        const workflow = result.workflow;
        const folderName = workflow.github_folder ||
                          name.toLowerCase().replace(/[^a-z0-9]+/g, '');

        // If cron was configured, update it in database after workflow creation
        if (cronConfig.enabled && cronConfig.expression && workflow.id) {
          try {
            const cronResponse = await fetch(`/api/remote-workflows/${workflow.id}/cron`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                cron_expression: cronConfig.expression,
                cron_timezone: cronConfig.timezone,
                cron_enabled: cronConfig.enabled,
                cron_max_concurrent: cronConfig.maxConcurrent,
                cron_retry_on_failure: cronConfig.retryOnFailure,
                cron_retry_count: cronConfig.retryCount,
              }),
            });

            const cronResult = await cronResponse.json();
            if (!cronResult.success) {
              console.warn('Failed to update cron config:', cronResult.error);
              toast.warning('Workflow created but cron schedule update failed');
            }
          } catch (cronError) {
            console.error('Error updating cron config:', cronError);
            toast.warning('Workflow created but cron schedule update failed');
          }
        }

        toast.success(
          `Workflow "${name}" created successfully! Synced to GitHub: ${folderName}/workflow.yaml - Version: ${workflow.version_info?.version_number || '1.0.0'}`
        );
        onWorkflowCreated?.(result.workflow);
        onOpenChange(false);
        resetForm();
      } else {
        toast.error(result.error || 'Failed to create workflow');
      }
    } catch (error) {
      console.error('Error creating workflow:', error);
      toast.error('Failed to create workflow');
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
    setActiveTab('template');
    setCronConfig({
      expression: '',
      timezone: 'UTC',
      enabled: false,
      maxConcurrent: 1,
      retryOnFailure: true,
      retryCount: 3,
    });
  };

  const copyTemplate = (templateContent: string) => {
    navigator.clipboard.writeText(templateContent);
    console.log('Template copied to clipboard!');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="template">Templates</TabsTrigger>
            <TabsTrigger value="manual">Manual Creation</TabsTrigger>
          </TabsList>

          <TabsContent value="template" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  Template selected: <strong>{templates[selectedTemplate].name}</strong>
                </p>
                <p className="text-xs text-blue-600">
                  Click &quot;Manual Creation&quot; tab to customize the workflow details.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="manual" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Basic Information */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="workflow-name">Workflow Name *</Label>
                  <Input
                    id="workflow-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My Awesome Workflow"
                    className="mt-1"
                  />
                </div>

                <div>
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

                <div className="grid grid-cols-2 gap-4">
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
                <div>
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

                {/* Schedule Configuration */}
                <div>
                  <Label className="font-mono text-xs text-gray-600 uppercase">
                    Schedule (Optional)
                  </Label>
                  <div className="mt-2">
                    <CronScheduleEditor
                      cronExpression={cronConfig.expression}
                      cronTimezone={cronConfig.timezone}
                      cronEnabled={cronConfig.enabled}
                      cronMaxConcurrent={cronConfig.maxConcurrent}
                      cronRetryOnFailure={cronConfig.retryOnFailure}
                      cronRetryCount={cronConfig.retryCount}
                      onChange={setCronConfig}
                      showAdvanced={false}
                    />
                  </div>
                </div>
              </div>

              {/* Automation Sequence */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="automation-sequence">
                    Automation Sequence (YAML) *
                  </Label>
                  <Textarea
                    id="automation-sequence"
                    value={automationSequence}
                    onChange={(e) => setAutomationSequence(e.target.value)}
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
                    className="mt-1 font-mono text-sm"
                    rows={20}
                  />
                </div>

                {/* YAML Validation */}
                {automationSequence && (
                  <div className="text-xs">
                    <YAMLValidator content={automationSequence} />
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex justify-between">
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
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle className="w-4 h-4" />
          <span>Invalid YAML: {validation.error}</span>
        </div>
      )}
    </div>
  );
}
