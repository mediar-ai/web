# JSONB Migration Guide

## Overview

This document describes the migration from individual database columns to JSONB storage for LLM structured output, providing flexibility for future schema changes while maintaining backward compatibility.

## What We've Implemented

### ✅ Database Schema
- Added `llm_structured_output JSONB` column to `low_level_workflow_analyses` table
- Created GIN indexes for efficient JSONB queries
- Maintained legacy columns for backward compatibility

### ✅ Type System
- `LLMStructuredOutput` interface supporting both v1 and v2 schemas
- `WorkflowStepAnalysisWithJSONB` for database records
- `FlattenedWorkflowAnalysis` for backward-compatible UI access

### ✅ Helper Functions (`src/lib/workflowAnalysisHelpers.ts`)
- `flattenWorkflowAnalysis()` - Prioritizes JSONB over legacy columns
- `createLegacyStructuredOutput()` - Creates v1 format
- `createV2StructuredOutput()` - Creates v2 format
- Schema version detection and migration utilities

### ✅ LLM Integration (`src/lib/llmSchemas.ts`)
- `legacyAnalysisSchema` - Original 8-field format
- `v2AnalysisSchema` - New 8-field format
- `hybridAnalysisSchema` - Supports both formats
- Schema version selection

### ✅ Enhanced Analysis Functions
- Updated `saveWorkflowStepAnalysis()` to store both legacy and JSONB
- New `generateWorkflowStepAnalysisWithSchema()` for configurable schemas
- `saveWorkflowStepAnalysisWithCustomOutput()` for pure JSONB storage

### ✅ API Updates
- `fetch-llm-analyses` endpoint returns flattened data for backward compatibility
- Raw JSONB data available for advanced use cases

### ✅ UI Compatibility
- Steps page uses `FlattenedWorkflowAnalysis` type
- Labeling page updated for new type system
- Workflow types updated across components

### ✅ Migration Tools
- Database migration SQL (`supabase/migrations/20241201000000_add_jsonb_llm_output.sql`)
- Data migration script (`scripts/migrate-to-jsonb.js`)
- Verification and indexing utilities

## Schema Comparison

### V1 Legacy (Current)
```typescript
{
  workflow: "User Registration Process",
  step: "Fill contact form", 
  description: "User enters personal information",
  facts: "Form has name and email fields",
  logic: "Email validation required",
  tech: "React form, Chrome browser",
  apps: "Registration App",
  context: "signup.example.com/register"
}
```

### V2 New (Proposed)
```typescript
{
  step_title: "Fill contact form",
  step_summary: "User entered name and email in registration form",
  events_that_happened: "Clicked name field, typed 'John Doe', clicked email field, typed 'john@example.com'",
  how_content_changed: "Form fields populated with user input, validation indicators appeared",
  results_if_any: "Form validation passed, submit button became enabled",
  what_was_clicked: "Name input field, email input field",
  what_was_typed: "John Doe, john@example.com", 
  user_intent: "Complete registration by providing required contact information"
}
```

## Usage Examples

### Reading Data (Works with both legacy and JSONB)
```typescript
import { flattenWorkflowAnalysis } from '@/lib/workflowAnalysisHelpers';

const analysis = await fetchAnalysis(id);
const flattened = flattenWorkflowAnalysis(analysis);

// Always works regardless of storage method
console.log(flattened.workflow);
console.log(flattened.step);
```

### Generating V2 Analysis
```typescript
import { generateWorkflowStepAnalysisWithSchema } from '@/lib/workflowAnalysis';
import { WORKFLOW_STEP_ANALYSIS_V2_PROMPT } from '@/lib/prompts';

const v2Analysis = await generateWorkflowStepAnalysisWithSchema(
  WORKFLOW_STEP_ANALYSIS_V2_PROMPT,
  'gemini-2.5-pro-preview-06-05',
  context,
  'v2_new'
);
```

## Migration Process

### 1. Apply Database Migration
```bash
# The migration adds the JSONB column and indexes
supabase db push
```

### 2. Migrate Existing Data
```bash
cd scripts
node migrate-to-jsonb.js all
```

### 3. Verify Migration
```bash
node migrate-to-jsonb.js verify
```

## Benefits Achieved

### 🎯 Schema Flexibility
- Add new fields without database migrations
- Support multiple schema versions simultaneously
- Easy experimentation with different analysis formats

### 🚀 Performance
- JSONB GIN indexes for fast queries
- Efficient storage and retrieval
- Advanced PostgreSQL JSONB features

### 🔄 Backward Compatibility  
- Existing code continues to work unchanged
- Gradual migration path
- Legacy columns preserved during transition

### 🔮 Future-Proofing
- Ready for new LLM output formats
- Support for model-specific schemas
- Extensible metadata storage

## Current State

The implementation provides a complete foundation for flexible LLM output storage while maintaining full backward compatibility. The system can now:

1. **Store both legacy and JSONB data** simultaneously
2. **Access data uniformly** regardless of storage method
3. **Generate analyses** using either schema version
4. **Query efficiently** using JSONB indexes
5. **Migrate gradually** without disrupting existing workflows

## Next Steps

To fully utilize the new architecture:

1. **Test the migration** on your dataset
2. **Experiment with V2 schema** for new analyses  
3. **Monitor performance** with JSONB queries
4. **Gradually transition** to pure JSONB storage
5. **Deprecate legacy columns** once migration is complete

The foundation is now in place for a flexible, performant, and future-proof LLM analysis system. 