-- Migration: Remove tags and difficulty_level columns from deployed_workflows
-- Created: 2025-01-13
-- Description: Remove hashtags/tags and difficulty level fields from workflow schema

-- Drop the index on tags first
DROP INDEX IF EXISTS "idx_deployed_workflows_tags";

-- Remove the columns
ALTER TABLE "public"."deployed_workflows"
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS difficulty_level; 