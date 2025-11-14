# TypeScript Workflow Version Creation - Testing Guide

## Overview

This document describes the testing strategy for TypeScript workflow version creation and GitHub webhook integration to ensure high confidence and prevent regressions.

## Critical Behaviors to Test

### 1. Version Creation on Git Push

**Expected Behavior:**
- When a TypeScript workflow file (`*/src/terminator.ts`) is pushed to GitHub
- The webhook should:
  1. Parse the TypeScript workflow metadata
  2. Query for the latest version number
  3. Increment the patch version (e.g., 1.0.5 → 1.0.6)
  4. Create a new version record in `deployed_workflow_versions`
  5. Activate the new version using `activate_workflow_version` RPC
  6. Update the workflow record with `current_version_id`

**Test Cases:**
```typescript
describe('TypeScript Workflow Version Creation', () => {
  it('should create version when terminator.ts is modified', async () => {
    // Given: A TypeScript workflow exists with version 1.0.5
    // When: Push commit with changes to src/terminator.ts
    // Then: Version 1.0.6 should be created and activated
  });

  it('should handle new TypeScript workflow creation', async () => {
    // Given: No existing workflow
    // When: Push commit with new */src/terminator.ts file
    // Then: Workflow and version 1.0.0 should be created
  });
});
```

### 2. Circular Loop Prevention

**Expected Behavior:**
- When the dashboard/app creates a version, it commits to GitHub with message "Update workflow: {name} (v{version})"
- The webhook should detect this pattern and ignore it to prevent:
  - Dashboard creates version → pushes to GitHub
  - Webhook creates duplicate version → pushes to GitHub again
  - Infinite loop ❌

**Test Cases:**
```typescript
describe('Circular Loop Prevention', () => {
  it('should ignore commits with "Update workflow:" pattern', async () => {
    // Given: Dashboard pushes commit with message "Update workflow: Test (v1.0.5)"
    // When: Webhook receives push event
    // Then: Should return "Ignored automated push"
    // And: Should NOT create a new version
  });

  it('should process commits without "Update workflow:" pattern', async () => {
    // Given: Developer pushes commit with message "feat: add new feature"
    // When: Webhook receives push event
    // Then: Should create new version
  });
});
```

### 3. Version Metadata Integrity

**Expected Behavior:**
- Version records should contain:
  - `automation_sequence`: Parsed TypeScript metadata (not YAML)
  - `automation_sequence_yaml`: null
  - `preferred_format`: 'typescript'
  - `version_number`: Auto-incremented
  - `is_active`: false initially, then true after activation

**Test Cases:**
```typescript
describe('Version Metadata', () => {
  it('should store correct TypeScript metadata structure', async () => {
    // Given: TypeScript workflow with metadata
    // When: Version is created
    // Then: automation_sequence should contain parsed TS metadata
    // And: automation_sequence_yaml should be null
    // And: preferred_format should be 'typescript'
  });
});
```

## Integration Testing

### Manual Testing Checklist

✅ **Test 1: Dashboard → GitHub → Webhook (No Duplicate)**
1. Create/update workflow version in dashboard
2. Verify commit appears in GitHub with "Update workflow:" message
3. Check webhook deliveries - should show "Ignored automated push"
4. Confirm only ONE version exists in database

✅ **Test 2: Git Push → Webhook → Version Creation**
1. Modify `src/terminator.ts` file locally
2. Commit with message NOT containing "Update workflow:"
3. Push to GitHub
4. Check webhook deliveries - should show success
5. Verify new version appears in dashboard
6. Confirm version is activated (is_active = true)

✅ **Test 3: Version Number Increment**
1. Note current version number (e.g., 1.0.5)
2. Push change to TypeScript workflow
3. Verify new version is 1.0.6 (patch incremented)

### Automated Testing Commands

```bash
# Run webhook tests
cd mediar-web-app
npm test src/app/api/webhooks/github/route.test.ts

# Check webhook deliveries for specific commit
gh api repos/mediar-ai/workflows/hooks/HOOK_ID/deliveries/DELIVERY_ID

# Verify version in database
# (Requires Supabase access)
```

## Monitoring in Production

### Key Metrics to Track

1. **Webhook Success Rate**
   - Monitor `/api/webhooks/github` responses
   - Alert on error rate > 5%

2. **Version Creation Success**
   - Track `deployed_workflow_versions` inserts
   - Monitor for constraint violations

3. **Circular Loop Detection**
   - Count "Ignored automated push" responses
   - Should match dashboard version creation count

### Log Monitoring

Key log patterns to watch:
```
✅ "📝 Creating TypeScript version X for workflow Y"
✅ "🔄 Activating TypeScript version X"
✅ "✅ Parsed TypeScript workflow: {name}"
❌ "❌ Version creation failed"
✅ "🤖 Ignoring automated push from Mediar system"
```

## Regression Testing

### Before Deploying Changes

Run this checklist before deploying webhook changes:

1. ✅ Verify existing TypeScript workflows still sync
2. ✅ Test dashboard version creation doesn't create duplicates
3. ✅ Confirm version numbers increment correctly
4. ✅ Check webhook ignores "Update workflow:" commits
5. ✅ Validate version activation works

### Known Edge Cases

1. **Multiple commits in single push**
   - Webhook should handle multiple workflow changes
   - Each should get its own version

2. **Version conflict during concurrent pushes**
   - Database constraints should prevent duplicate versions
   - Webhook should handle gracefully

3. **Parse errors in TypeScript files**
   - Should set `github_sync_status` to 'failed'
   - Should NOT create partial version records

## Current Test Coverage

### Existing Tests
- ✅ Signature validation
- ✅ Branch filtering (main/dev only)
- ✅ YAML workflow detection
- ✅ JS file upload handling
- ✅ Circular loop prevention (message check)

### Added Tests (TypeScript Workflows)
- ✅ TypeScript workflow detection (`*/src/terminator.ts` pattern)
- ✅ Version creation and increment logic
- ✅ Version activation
- ✅ Circular loop prevention verification
- ⚠️ TypeScript parser error handling (needs mocking setup)

### Gaps (Future Work)
- ⚠️ Concurrent push handling
- ⚠️ Parse error recovery
- ⚠️ Version conflict resolution
- ⚠️ Multi-workflow push handling

## Quick Reference

### Webhook Ignore Patterns
```typescript
const isAutomatedPush =
  pusher.includes('mediar') ||
  pusher.includes('workflow-manager') ||
  commitAuthor.includes('mediar') ||
  commitAuthor.includes('workflow-manager') ||
  headCommit?.message?.includes('Update workflow:') ||
  headCommit?.message?.includes('Add/Update workflow:') ||
  headCommit?.message?.includes('Update default values:');
```

### Version Creation Flow
```
1. Detect TypeScript workflow change (*/src/terminator.ts)
2. Look up existing workflow by github_folder
3. Parse TypeScript metadata
4. Query latest version number
5. Increment patch version
6. Insert new version record
7. Activate version (RPC call)
8. Update workflow.current_version_id
9. Set github_sync_status = 'synced'
```

### Database Schema
```sql
-- deployed_workflow_versions
CREATE TABLE deployed_workflow_versions (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER NOT NULL REFERENCES deployed_workflows(id),
  version_number TEXT NOT NULL,
  automation_sequence JSONB NOT NULL,  -- TypeScript metadata
  automation_sequence_yaml TEXT,         -- NULL for TypeScript
  preferred_format TEXT NOT NULL,        -- 'typescript'
  is_active BOOLEAN DEFAULT false,
  change_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```
