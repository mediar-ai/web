-- Migration: Add comprehensive synthesis data storage
-- Created: 2025-01-22
-- Description: Stores complete synthesis process including context, boundaries, conversations, and workflow data

CREATE TABLE saved_workflow_syntheses (
    id bigint PRIMARY KEY,
    user_id uuid NOT NULL,
    title text NOT NULL DEFAULT 'Untitled Synthesis',
    description text,
    synthesis_process_data jsonb NOT NULL,
    synthesis_session_id bigint,
    workflow_ids text NOT NULL DEFAULT '{}',
    workflow_context jsonb,
    identified_workflow_names text DEFAULT '{}',
    workflow_boundaries jsonb,
    conversation_history jsonb NOT NULL,
    synthesis_results jsonb,
    models_used text DEFAULT '{}',
    total_tokens_used integer DEFAULT 0,
    synthesis_duration_seconds integer,
    version text DEFAULT '1.0',
    is_active boolean DEFAULT true,
    synthesis_started_at timestamp,
    synthesis_completed_at timestamp,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    saved_by_user_id uuid
);

CREATE INDEX idx_saved_syntheses_user_id ON saved_workflow_syntheses(user_id);
CREATE INDEX idx_saved_syntheses_created_at ON saved_workflow_syntheses(created_at);
CREATE INDEX idx_saved_syntheses_session_id ON saved_workflow_syntheses(synthesis_session_id); 