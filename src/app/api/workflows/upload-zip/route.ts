import { NextRequest, NextResponse } from 'next/server';
import * as yaml from 'js-yaml';
import JSZip from 'jszip';
import { WorkflowFileManager, WorkflowFile } from '@/lib/workflow-file-manager';
import { createClient } from '@supabase/supabase-js';
import { extractCronConfigFromYAML } from '@/lib/cronParser';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Check file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: 'File size exceeds 10MB limit' },
        { status: 400 }
      );
    }

    // Read and parse ZIP file
    const buffer = await file.arrayBuffer();
    const zip = new JSZip();

    let zipContent;
    try {
      zipContent = await zip.loadAsync(buffer);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid ZIP file format' },
        { status: 400 }
      );
    }

    // Look for terminator.yml or terminator.yaml
    let workflowFile = zipContent.file('terminator.yml') || zipContent.file('terminator.yaml');

    // If not in root, search in subdirectories
    if (!workflowFile) {
      const files = Object.keys(zipContent.files);
      const workflowPath = files.find(path =>
        path.endsWith('terminator.yml') || path.endsWith('terminator.yaml')
      );

      if (workflowPath) {
        workflowFile = zipContent.file(workflowPath);
      }
    }

    if (!workflowFile) {
      return NextResponse.json(
        { success: false, error: 'No terminator.yml or terminator.yaml found in ZIP' },
        { status: 400 }
      );
    }

    // Extract and parse workflow YAML
    let workflowContent = await workflowFile.async('string');

    let workflowData;
    try {
      workflowData = yaml.load(workflowContent) as any;
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid YAML format in workflow file' },
        { status: 400 }
      );
    }

    // Validate workflow structure
    const validationResult = validateWorkflowStructure(workflowData);
    if (!validationResult.valid) {
      return NextResponse.json(
        { success: false, error: validationResult.error },
        { status: 400 }
      );
    }

    // Get list of all files in ZIP and normalize paths
    const fileList = Object.keys(zipContent.files)
      .filter(path => !zipContent.files[path].dir)
      .map(path => path.replace(/\\/g, '/'));  // Normalize Windows paths to use forward slashes

    // Check for JavaScript files referenced in workflow
    const jsFiles = fileList.filter(path => path.endsWith('.js'));
    const { files: referencedFilePaths, references: fileReferences } = extractReferencedFiles(workflowContent);

    // Validate that referenced files exist in the ZIP
    const missingFiles: string[] = [];
    const missingReferences: FileReference[] = [];
    const foundFiles: string[] = [];

    referencedFilePaths.forEach(ref => {
      // Check for exact match or with common path variations
      const found = fileList.some(file => {
        // Normalize paths for comparison
        const normalizedFile = file.replace(/\\/g, '/');
        const normalizedRef = ref.replace(/\\/g, '/').replace(/^\.\//, '');

        // Check if file ends with the reference or contains it as a path segment
        return normalizedFile.endsWith(normalizedRef) ||
               normalizedFile.endsWith('/' + normalizedRef) ||
               normalizedFile === normalizedRef;
      });

      if (found) {
        foundFiles.push(ref);
      } else {
        missingFiles.push(ref);
        // Find the reference info for this missing file
        const refInfo = fileReferences.find(r => r.path === ref);
        if (refInfo) {
          missingReferences.push(refInfo);
        }
      }
    });

    // Fail validation if any referenced files are missing
    if (missingFiles.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Missing required files in ZIP: ${missingFiles.join(', ')}`,
          details: {
            missingFiles,
            missingReferences,
            foundFiles,
            availableFiles: jsFiles
          }
        },
        { status: 400 }
      );
    }

    // Extract JavaScript files for upload
    // Strip the root folder name if present (e.g., "test-workflow-with-files/")
    let filesToUpload: WorkflowFile[] = [];

    // Intelligently handle root folders in ZIP structure
    let pathsToProcess = jsFiles;

    // Check if all files are in a single root folder that matches common patterns
    if (jsFiles.length > 0) {
      const firstPath = jsFiles[0];
      const firstSlash = firstPath.indexOf('/');

      if (firstSlash > 0) {
        const rootFolder = firstPath.substring(0, firstSlash);

        // Check if all files start with this root folder
        if (jsFiles.every(f => f.startsWith(rootFolder + '/'))) {
          console.log(`🗂️ Detected common root folder: ${rootFolder}`);

          // Check if the root folder appears to be redundant
          // (e.g., "sap_with_login/sap_with_login/..." or "workflow-name/workflow-name/...")
          const pathAfterRoot = firstPath.substring(firstSlash + 1);
          const secondSlash = pathAfterRoot.indexOf('/');

          if (secondSlash > 0) {
            const secondFolder = pathAfterRoot.substring(0, secondSlash);

            // If the root folder and second folder are the same (or very similar), strip the root
            if (rootFolder === secondFolder ||
                rootFolder.replace(/[-_]/g, '') === secondFolder.replace(/[-_]/g, '')) {
              console.log(`🔄 Stripping redundant root folder: ${rootFolder}`);
              pathsToProcess = jsFiles.map(f => f.substring(rootFolder.length + 1));
            }
          }
        }
      }
    }

    // Create a mapping of normalized paths to original ZIP paths
    const originalPaths = Object.keys(zipContent.files).filter(path => !zipContent.files[path].dir);
    const pathMapping = new Map<string, string>();
    originalPaths.forEach(orig => {
      const normalized = orig.replace(/\\/g, '/');
      if (jsFiles.includes(normalized)) {
        pathMapping.set(normalized, orig);
      }
    });

    for (let i = 0; i < jsFiles.length; i++) {
      const normalizedPath = jsFiles[i];
      const processedPath = pathsToProcess[i];
      const originalZipPath = pathMapping.get(normalizedPath) || normalizedPath;
      const file = zipContent.file(originalZipPath);

      if (file) {
        const content = await file.async('nodebuffer');
        console.log(`📄 Adding JS file - ZIP: ${originalZipPath}, Processed: ${processedPath}`);
        filesToUpload.push({
          path: processedPath,
          content: content as Buffer
        });
      }
    }

    // Check if this is part of a workflow creation request
    const isCreating = formData.get('action') === 'create';
    let workflowId: number | null = null;
    let fileUrls: Record<string, string> = {};

    if (isCreating) {
      // Create the workflow (regardless of whether there are files)
      console.log('🚀 Creating new workflow from ZIP upload');

      // Set requires_files flag if there are JS files
      if (jsFiles.length > 0) {
        workflowData.requires_files = true;
      }

      // Use the user-provided name and description if available
      const userProvidedName = formData.get('name') as string;
      const userProvidedDescription = formData.get('description') as string;

      // Create workflow record
      const workflowRecord = {
        name: userProvidedName || workflowData.name || 'Untitled Workflow',
        description: userProvidedDescription || workflowData.description || '',
        version: workflowData.version || '1.0.0',
        status: 'deployed',
        workflow_type: 'execution',
        automation_sequence: workflowData,
        requires_files: jsFiles.length > 0,
        cron_expression: extractCronConfigFromYAML(workflowContent)?.expression || null,
        cron_timezone: extractCronConfigFromYAML(workflowContent)?.timezone || 'UTC',
        cron_enabled: extractCronConfigFromYAML(workflowContent)?.enabled || false,
        created_by: null,
        total_versions: 1,
      };

      const { data: newWorkflow, error: workflowError } = await supabase
        .from('deployed_workflows')
        .insert(workflowRecord)
        .select()
        .single();

      if (workflowError || !newWorkflow) {
        console.error('Failed to create workflow:', workflowError);
        return NextResponse.json(
          { success: false, error: 'Failed to create workflow' },
          { status: 500 }
        );
      }

      workflowId = newWorkflow.id;
      console.log(`✅ Created workflow with ID: ${workflowId}`);

      // Create version record
      const versionRecord = {
        workflow_id: workflowId,
        version_number: '1.0.0',
        automation_sequence_yaml: workflowContent,
        automation_sequence: workflowData,
        preferred_format: 'yaml',
        is_active: true,
        change_notes: 'Initial version from ZIP upload',
      };

      const { error: versionError } = await supabase
        .from('deployed_workflow_versions')
        .insert(versionRecord);

      if (versionError) {
        console.error('Failed to create version:', versionError);
        // Clean up workflow if version creation failed
        await supabase.from('deployed_workflows').delete().eq('id', workflowId);
        return NextResponse.json(
          { success: false, error: 'Failed to create workflow version' },
          { status: 500 }
        );
      }
    } else if (formData.get('workflowId')) {
      // VERSION UPLOAD - when workflowId is provided but action !== 'create'
      workflowId = parseInt(formData.get('workflowId') as string);
      console.log(`📦 Creating new version for workflow ${workflowId} from ZIP upload`);

      // Get current workflow to determine next version
      const { data: currentWorkflow, error: fetchError } = await supabase
        .from('deployed_workflows')
        .select('id, name, total_versions')
        .eq('id', workflowId)
        .single();

      if (fetchError || !currentWorkflow) {
        return NextResponse.json(
          { success: false, error: 'Workflow not found' },
          { status: 404 }
        );
      }

      // Calculate next version number
      const nextVersionNumber = `${(currentWorkflow.total_versions || 0) + 1}.0.0`;

      // Create version record
      const versionRecord = {
        workflow_id: workflowId,
        version_number: nextVersionNumber,
        automation_sequence_yaml: workflowContent,
        automation_sequence: workflowData,
        preferred_format: 'yaml',
        is_active: false, // Don't activate by default
        change_notes: 'Version uploaded via ZIP file',
      };

      const { data: newVersion, error: versionError } = await supabase
        .from('deployed_workflow_versions')
        .insert(versionRecord)
        .select()
        .single();

      if (versionError) {
        console.error('Failed to create version:', versionError);
        return NextResponse.json(
          { success: false, error: 'Failed to create workflow version' },
          { status: 500 }
        );
      }

      // Update the workflow's total_versions and automation_sequence if needed
      await supabase
        .from('deployed_workflows')
        .update({
          total_versions: (currentWorkflow.total_versions || 0) + 1,
          automation_sequence: workflowData, // Update to latest
          requires_files: jsFiles.length > 0
        })
        .eq('id', workflowId);

      console.log(`✅ Created version ${nextVersionNumber} for workflow ${workflowId}`);

      // Store version info for response
      workflowData.version = nextVersionNumber;
      workflowData.versionRecord = newVersion;
    }

    // Upload files to storage if there are any
    if (filesToUpload.length > 0 && (workflowId || formData.get('workflowId'))) {
      if (!workflowId) {
        workflowId = parseInt(formData.get('workflowId') as string);
      }
      const version = workflowData.version || '1.0.0';

      // Normalize paths and detect subdirectory
      let detectedSubdir: string | undefined;
      if (filesToUpload.length > 0) {
        // Normalize all paths to use forward slashes
        filesToUpload = filesToUpload.map(f => ({
          ...f,
          path: f.path.replace(/\\/g, '/')
        }));

        console.log(`🔍 Analyzing ${filesToUpload.length} files for subdirectory detection:`);
        filesToUpload.forEach(f => console.log(`  - ${f.path}`));

        const firstFile = filesToUpload[0].path;
        const firstSlash = firstFile.indexOf('/');
        console.log(`📊 First file: ${firstFile}, slash at position: ${firstSlash}`);

        if (firstSlash > 0) {
          const potentialSubdir = firstFile.substring(0, firstSlash);
          console.log(`📂 Potential subdirectory: ${potentialSubdir}`);

          // Check if all files start with this subdirectory
          const allMatch = filesToUpload.every(f => f.path.startsWith(potentialSubdir + '/'));
          console.log(`✅ All files match pattern: ${allMatch}`);

          if (allMatch) {
            detectedSubdir = potentialSubdir;
            console.log(`📁 Successfully detected subdirectory: ${detectedSubdir}`);
          } else {
            console.log(`❌ Not all files match the subdirectory pattern`);
          }
        } else {
          console.log(`❌ No subdirectory detected (no slash found or at position 0)`);
        }
      }

      const fileManager = new WorkflowFileManager();
      const uploadResult = await fileManager.uploadWorkflowFiles(
        workflowId,
        version,
        filesToUpload,
        detectedSubdir
      );

      if (uploadResult.success) {
        // Update deployed_workflows table with files_config including subdirectory
        await supabase
          .from('deployed_workflows')
          .update({
            requires_files: true,
            files_config: {
              file_count: filesToUpload.length,
              total_size: filesToUpload.reduce((sum, f) => sum + f.content.length, 0),
              subdirectory: detectedSubdir || null,
              last_updated: new Date().toISOString()
            }
          })
          .eq('id', workflowId);

        // Get signed URLs for the files
        fileUrls = await fileManager.getSignedUrls(workflowId, version);

        // Update YAML with file URLs
        workflowContent = fileManager.updateYamlWithFileUrls(workflowContent, fileUrls);
      } else {
        console.error('Failed to upload files:', uploadResult.error);
      }
    }

    // Extract metadata and prepare response
    const response: any = {
      success: true,
      workflowId: workflowId,
      workflowData: {
        name: workflowData.name || 'Untitled Workflow',
        description: workflowData.description || '',
        version: workflowData.version || '1.0.0',
        yaml: workflowContent,
        tags: workflowData.metadata?.tags || [],
        files: fileList,
        jsFiles: jsFiles,
        referencedFiles: referencedFilePaths,
        missingFiles: missingFiles,
        fileUrls: fileUrls,
        hasExternalFiles: filesToUpload.length > 0,
        // Include additional metadata
        config: workflowData.config || {},
        variables: workflowData.variables || {},
        steps: Array.isArray(workflowData.steps) ? workflowData.steps.length : 0,
      },
      message: isCreating ? `Workflow created with ID ${workflowId}` : 'ZIP file processed successfully'
    };

    // Add version info if this was a version upload
    if ((workflowData as any).versionRecord) {
      response.version = (workflowData as any).versionRecord;
    }

    // Store JavaScript files for later use (optional - for future implementation)
    // This would involve saving files to a storage location and updating workflow paths

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error processing ZIP upload:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process ZIP file' },
      { status: 500 }
    );
  }
}

function validateWorkflowStructure(data: any): { valid: boolean; error?: string } {
  // Check for required fields
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid workflow format' };
  }

  // Check for steps - either direct steps or in execute_sequence format
  const hasDirectSteps = Array.isArray(data.steps) && data.steps.length > 0;
  const hasExecuteSequence =
    data.tool_name === 'execute_sequence' &&
    data.arguments?.steps &&
    Array.isArray(data.arguments.steps);

  if (!hasDirectSteps && !hasExecuteSequence) {
    return { valid: false, error: 'Workflow must contain steps array' };
  }

  // Validate step structure
  const steps = hasDirectSteps ? data.steps : data.arguments.steps;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Check for tool_name or name
    if (!step.tool_name && !step.name) {
      return {
        valid: false,
        error: `Step ${i + 1} missing tool_name or name field`
      };
    }

    // For run_command with engine, check if it references files
    if (step.tool_name === 'run_command' && step.engine) {
      if (step.run && step.run.includes('require(')) {
        // Contains file references - this is fine
      }
    }
  }

  return { valid: true };
}

interface FileReference {
  path: string;
  lineNumber: number;
  context: string;
  pattern: string;
}

function extractReferencedFiles(yamlContent: string): { files: string[]; references: FileReference[] } {
  const files: string[] = [];
  const references: FileReference[] = [];
  const foundPaths = new Set<string>();
  const lines = yamlContent.split('\n');

  // Helper to get line number from match index
  const getLineNumber = (matchIndex: number): number => {
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      charCount += lines[i].length + 1; // +1 for newline
      if (charCount > matchIndex) {
        return i + 1;
      }
    }
    return lines.length;
  };

  // Helper to get context (the line where the match was found)
  const getContext = (lineNum: number): string => {
    return lines[lineNum - 1]?.trim() || '';
  };

  // Pattern 1: require() statements in JavaScript code blocks
  const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;

  while ((match = requirePattern.exec(yamlContent)) !== null) {
    const filePath = match[1];
    if (!foundPaths.has(filePath)) {
      foundPaths.add(filePath);
      files.push(filePath);
      const lineNumber = getLineNumber(match.index);
      references.push({
        path: filePath,
        lineNumber,
        context: getContext(lineNumber),
        pattern: 'require()'
      });
    }
  }

  // Pattern 2: ES6 import statements
  const importPattern = /import\s+.*\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = importPattern.exec(yamlContent)) !== null) {
    const filePath = match[1];
    if (!foundPaths.has(filePath) && (filePath.endsWith('.js') || filePath.includes('/'))) {
      foundPaths.add(filePath);
      files.push(filePath);
      const lineNumber = getLineNumber(match.index);
      references.push({
        path: filePath,
        lineNumber,
        context: getContext(lineNumber),
        pattern: 'import'
      });
    }
  }

  // Pattern 3: File references in load_file or similar commands
  const loadFilePattern = /load_file\s*[:=]\s*['"]([^'"]+)['"]/g;
  while ((match = loadFilePattern.exec(yamlContent)) !== null) {
    const filePath = match[1];
    if (!foundPaths.has(filePath)) {
      foundPaths.add(filePath);
      files.push(filePath);
      const lineNumber = getLineNumber(match.index);
      references.push({
        path: filePath,
        lineNumber,
        context: getContext(lineNumber),
        pattern: 'load_file'
      });
    }
  }

  // Pattern 4: File references in script_path or file_path fields
  const pathFieldPattern = /(?:script_path|file_path|source_file)\s*:\s*['"]?([^'"\s\n]+\.js)['"]?/g;
  while ((match = pathFieldPattern.exec(yamlContent)) !== null) {
    const filePath = match[1];
    if (!foundPaths.has(filePath)) {
      foundPaths.add(filePath);
      files.push(filePath);
      const lineNumber = getLineNumber(match.index);
      references.push({
        path: filePath,
        lineNumber,
        context: getContext(lineNumber),
        pattern: 'file path field'
      });
    }
  }

  return { files, references };
}