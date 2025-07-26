-- Migration: Remove orchestration tracking from synthesis_sessions
-- Created: 2025-01-25
-- Description: Drops orchestration columns that were added for failed orchestration approaches

ALTER TABLE public.synthesis_sessions
DROP COLUMN IF EXISTS orchestration_status,
DROP COLUMN IF EXISTS orchestration_progress,
DROP COLUMN IF EXISTS orchestration_data,
DROP COLUMN IF EXISTS final_result_url; 