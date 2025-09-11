-- Migration: Comprehensive RLS Security Improvements
-- Created: 2026-01-30
-- Description: Enhance Row Level Security policies across all tables and add missing RLS

-- =====================================================
-- 1. ENABLE RLS ON TABLES MISSING IT
-- =====================================================

-- Enable RLS on core data tables
ALTER TABLE public.low_level_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_timeline_event_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_workflow_syntheses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_live_transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screenshot_processing_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mediar_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthesis_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.low_level_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.low_level_workflow_labeling ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.low_level_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_substeps ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 2. CREATE SECURE USER ISOLATION POLICIES
-- =====================================================

-- Policy for mediar_users: Users can only see and update their own profile
CREATE POLICY "users_own_profile_select" ON public.mediar_users
    FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "users_own_profile_update" ON public.mediar_users
    FOR UPDATE USING (auth.uid()::text = user_id)
    WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "users_own_profile_insert" ON public.mediar_users
    FOR INSERT WITH CHECK (auth.uid()::text = user_id);

-- =====================================================
-- 3. ORGANIZATION-BASED ACCESS POLICIES
-- =====================================================

-- Helper function to check if user belongs to an organization
CREATE OR REPLACE FUNCTION public.user_organization_id()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
    SELECT organization_id 
    FROM public.mediar_users 
    WHERE user_id = auth.uid()::text
    LIMIT 1;
$$;

-- Helper function to check if user is organization admin
CREATE OR REPLACE FUNCTION public.is_organization_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.mediar_users 
        WHERE user_id = auth.uid()::text 
        AND role = 'admin'
    );
$$;

-- =====================================================
-- 4. SECURE WORKFLOW ACCESS POLICIES
-- =====================================================

-- Low level workflows: Users can only access their own or their organization's workflows
CREATE POLICY "workflow_owner_or_org_select" ON public.low_level_workflows
    FOR SELECT USING (
        user_id = auth.uid()::text 
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.user_organization_id()
        )
    );

CREATE POLICY "workflow_owner_insert" ON public.low_level_workflows
    FOR INSERT WITH CHECK (
        user_id = auth.uid()::text
        AND (
            organization_id IS NULL 
            OR organization_id = public.user_organization_id()
        )
    );

CREATE POLICY "workflow_owner_update" ON public.low_level_workflows
    FOR UPDATE USING (
        user_id = auth.uid()::text 
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.user_organization_id()
            AND public.is_organization_admin()
        )
    );

CREATE POLICY "workflow_owner_delete" ON public.low_level_workflows
    FOR DELETE USING (
        user_id = auth.uid()::text 
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.user_organization_id()
            AND public.is_organization_admin()
        )
    );

-- =====================================================
-- 5. SECURE EVENT DATA ACCESS
-- =====================================================

-- Low level events: Users can only access their own events
CREATE POLICY "events_owner_select" ON public.low_level_events
    FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "events_owner_insert" ON public.low_level_events
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "events_owner_update" ON public.low_level_events
    FOR UPDATE USING (user_id = auth.uid()::text);

CREATE POLICY "events_owner_delete" ON public.low_level_events
    FOR DELETE USING (user_id = auth.uid()::text);

-- User activity data: Users can only access their own data
CREATE POLICY "activity_owner_select" ON public.user_activity_data
    FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "activity_owner_insert" ON public.user_activity_data
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);

-- =====================================================
-- 6. SECURE SESSION METADATA ACCESS
-- =====================================================

-- Session metadata: Users can only access their own sessions
CREATE POLICY "session_owner_select" ON public.session_metadata
    FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "session_owner_insert" ON public.session_metadata
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "session_owner_update" ON public.session_metadata
    FOR UPDATE USING (user_id = auth.uid()::text);

-- =====================================================
-- 7. SECURE ANALYSIS DATA ACCESS
-- =====================================================

-- Low level workflow analyses: Access based on workflow ownership
CREATE POLICY "analysis_workflow_owner_select" ON public.low_level_workflow_analyses
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = low_level_workflow_analyses.workflow_id
            AND (
                w.user_id = auth.uid()::text 
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.user_organization_id()
                )
            )
        )
    );

CREATE POLICY "analysis_workflow_owner_insert" ON public.low_level_workflow_analyses
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = workflow_id
            AND w.user_id = auth.uid()::text
        )
    );

-- =====================================================
-- 8. SECURE SYNTHESIS DATA ACCESS
-- =====================================================

-- Synthesis sessions: Users can only access their own sessions
CREATE POLICY "synthesis_owner_select" ON public.synthesis_sessions
    FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "synthesis_owner_insert" ON public.synthesis_sessions
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "synthesis_owner_update" ON public.synthesis_sessions
    FOR UPDATE USING (user_id = auth.uid()::text);

-- Saved workflow syntheses: Users can only access their own syntheses
CREATE POLICY "saved_synthesis_owner_select" ON public.saved_workflow_syntheses
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.synthesis_sessions s
            WHERE s.session_id = saved_workflow_syntheses.session_id
            AND s.user_id = auth.uid()::text
        )
    );

CREATE POLICY "saved_synthesis_owner_insert" ON public.saved_workflow_syntheses
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.synthesis_sessions s
            WHERE s.session_id = session_id
            AND s.user_id = auth.uid()::text
        )
    );

-- =====================================================
-- 9. SECURE DATASET ACCESS
-- =====================================================

-- Datasets: Organization-based access
CREATE POLICY "dataset_org_select" ON public.low_level_datasets
    FOR SELECT USING (
        organization_id = public.user_organization_id()
        OR (organization_id IS NULL AND created_by = auth.uid()::text)
    );

CREATE POLICY "dataset_org_insert" ON public.low_level_datasets
    FOR INSERT WITH CHECK (
        created_by = auth.uid()::text
        AND (
            organization_id IS NULL 
            OR organization_id = public.user_organization_id()
        )
    );

CREATE POLICY "dataset_org_update" ON public.low_level_datasets
    FOR UPDATE USING (
        (organization_id = public.user_organization_id() AND public.is_organization_admin())
        OR (organization_id IS NULL AND created_by = auth.uid()::text)
    );

-- =====================================================
-- 10. SECURE LABELING DATA ACCESS
-- =====================================================

-- Workflow labeling: Based on workflow ownership
CREATE POLICY "labeling_workflow_owner_select" ON public.low_level_workflow_labeling
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = low_level_workflow_labeling.workflow_id
            AND (
                w.user_id = auth.uid()::text 
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.user_organization_id()
                )
            )
        )
    );

CREATE POLICY "labeling_workflow_owner_insert" ON public.low_level_workflow_labeling
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = workflow_id
            AND w.user_id = auth.uid()::text
        )
    );

CREATE POLICY "labeling_workflow_owner_update" ON public.low_level_workflow_labeling
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = workflow_id
            AND (
                w.user_id = auth.uid()::text 
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.user_organization_id()
                    AND public.is_organization_admin()
                )
            )
        )
    );

-- =====================================================
-- 11. SECURE ANNOTATION ACCESS
-- =====================================================

-- Timeline annotations: User-based access
CREATE POLICY "annotations_user_select" ON public.raw_timeline_event_annotations
    FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "annotations_user_insert" ON public.raw_timeline_event_annotations
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "annotations_user_update" ON public.raw_timeline_event_annotations
    FOR UPDATE USING (user_id = auth.uid()::text);

CREATE POLICY "annotations_user_delete" ON public.raw_timeline_event_annotations
    FOR DELETE USING (user_id = auth.uid()::text);

-- =====================================================
-- 12. SECURE TRANSCRIPTION ACCESS
-- =====================================================

-- Agent transcriptions: User-based access
CREATE POLICY "transcription_user_select" ON public.agent_live_transcriptions
    FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "transcription_user_insert" ON public.agent_live_transcriptions
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "transcription_user_update" ON public.agent_live_transcriptions
    FOR UPDATE USING (user_id = auth.uid()::text);

-- =====================================================
-- 13. SECURE WORKFLOW STEP ACCESS
-- =====================================================

-- Workflow steps: Based on workflow ownership
CREATE POLICY "steps_workflow_owner_select" ON public.workflow_steps
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = workflow_steps.workflow_id
            AND (
                w.user_id = auth.uid()::text 
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.user_organization_id()
                )
            )
        )
    );

CREATE POLICY "steps_workflow_owner_insert" ON public.workflow_steps
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = workflow_id
            AND w.user_id = auth.uid()::text
        )
    );

-- Workflow substeps: Based on step ownership
CREATE POLICY "substeps_step_owner_select" ON public.workflow_substeps
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.workflow_steps s
            JOIN public.low_level_workflows w ON w.id = s.workflow_id
            WHERE s.id = workflow_substeps.step_id
            AND (
                w.user_id = auth.uid()::text 
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.user_organization_id()
                )
            )
        )
    );

CREATE POLICY "substeps_step_owner_insert" ON public.workflow_substeps
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.workflow_steps s
            JOIN public.low_level_workflows w ON w.id = s.workflow_id
            WHERE s.id = step_id
            AND w.user_id = auth.uid()::text
        )
    );

-- =====================================================
-- 14. SECURE JOB ACCESS
-- =====================================================

-- Workflow analysis jobs: User-based access
CREATE POLICY "jobs_user_select" ON public.workflow_analysis_jobs
    FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "jobs_user_insert" ON public.workflow_analysis_jobs
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "jobs_user_update" ON public.workflow_analysis_jobs
    FOR UPDATE USING (user_id = auth.uid()::text);

-- =====================================================
-- 15. SECURE LLM TRACES ACCESS
-- =====================================================

-- LLM traces: Organization-based access for monitoring
CREATE POLICY "traces_org_select" ON public.llm_traces
    FOR SELECT USING (
        user_id = auth.uid()::text
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.user_organization_id()
            AND public.is_organization_admin()
        )
    );

CREATE POLICY "traces_user_insert" ON public.llm_traces
    FOR INSERT WITH CHECK (
        user_id = auth.uid()::text
        AND (
            organization_id IS NULL 
            OR organization_id = public.user_organization_id()
        )
    );

-- =====================================================
-- 16. SCREENSHOT PROCESSING LOCKS
-- =====================================================

-- Screenshot locks: User-based access
CREATE POLICY "locks_user_select" ON public.screenshot_processing_locks
    FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "locks_user_insert" ON public.screenshot_processing_locks
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "locks_user_update" ON public.screenshot_processing_locks
    FOR UPDATE USING (user_id = auth.uid()::text);

CREATE POLICY "locks_user_delete" ON public.screenshot_processing_locks
    FOR DELETE USING (user_id = auth.uid()::text);

-- =====================================================
-- 17. IMPROVE EXISTING DEPLOYED WORKFLOWS POLICIES
-- =====================================================

-- Drop existing less secure policies
DROP POLICY IF EXISTS "Users can read active workflows" ON public.deployed_workflows;
DROP POLICY IF EXISTS "Authenticated users can create workflows" ON public.deployed_workflows;
DROP POLICY IF EXISTS "Users can update own workflows" ON public.deployed_workflows;
DROP POLICY IF EXISTS "Users can delete own workflows" ON public.deployed_workflows;

-- Create more secure policies with organization support
CREATE POLICY "deployed_workflows_secure_select" ON public.deployed_workflows
    FOR SELECT USING (
        status = 'active' 
        OR created_by = auth.uid()
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.user_organization_id()
        )
    );

CREATE POLICY "deployed_workflows_secure_insert" ON public.deployed_workflows
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL 
        AND created_by = auth.uid()
        AND (
            organization_id IS NULL 
            OR organization_id = public.user_organization_id()
        )
    );

CREATE POLICY "deployed_workflows_secure_update" ON public.deployed_workflows
    FOR UPDATE USING (
        created_by = auth.uid()
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.user_organization_id()
            AND public.is_organization_admin()
        )
    );

CREATE POLICY "deployed_workflows_secure_delete" ON public.deployed_workflows
    FOR DELETE USING (
        created_by = auth.uid()
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.user_organization_id()
            AND public.is_organization_admin()
        )
    );

-- =====================================================
-- 18. IMPROVE WORKFLOW EXECUTIONS POLICIES
-- =====================================================

-- Drop existing less secure policies
DROP POLICY IF EXISTS "Clients can see own executions" ON public.workflow_executions;
DROP POLICY IF EXISTS "System can insert executions" ON public.workflow_executions;
DROP POLICY IF EXISTS "System can update executions" ON public.workflow_executions;

-- Create more secure policies
CREATE POLICY "executions_secure_select" ON public.workflow_executions
    FOR SELECT USING (
        client_id = auth.uid()::text
        OR EXISTS (
            SELECT 1 FROM public.deployed_workflows w
            WHERE w.id = workflow_executions.workflow_id
            AND (
                w.created_by = auth.uid()
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.user_organization_id()
                )
            )
        )
    );

CREATE POLICY "executions_secure_insert" ON public.workflow_executions
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
        AND (
            client_id = auth.uid()::text
            OR EXISTS (
                SELECT 1 FROM public.deployed_workflows w
                WHERE w.id = workflow_id
                AND w.created_by = auth.uid()
            )
        )
    );

CREATE POLICY "executions_secure_update" ON public.workflow_executions
    FOR UPDATE USING (
        client_id = auth.uid()::text
        OR EXISTS (
            SELECT 1 FROM public.deployed_workflows w
            WHERE w.id = workflow_id
            AND (
                w.created_by = auth.uid()
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.user_organization_id()
                    AND public.is_organization_admin()
                )
            )
        )
    );

-- =====================================================
-- 19. ADD ORGANIZATION_ID WHERE MISSING
-- =====================================================

-- Add organization_id column to tables that need it
ALTER TABLE public.deployed_workflows 
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

ALTER TABLE public.workflow_executions 
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

ALTER TABLE public.llm_traces 
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

ALTER TABLE public.low_level_datasets 
    ADD COLUMN IF NOT EXISTS created_by TEXT;

-- =====================================================
-- 20. CREATE INDEXES FOR PERFORMANCE
-- =====================================================

-- Create indexes for RLS policy performance
CREATE INDEX IF NOT EXISTS idx_mediar_users_user_id_org ON public.mediar_users(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_workflows_user_id_org ON public.low_level_workflows(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON public.low_level_events(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_user_id ON public.user_activity_data(user_id);
CREATE INDEX IF NOT EXISTS idx_session_user_id ON public.session_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_org ON public.deployed_workflows(organization_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_client ON public.workflow_executions(client_id);
CREATE INDEX IF NOT EXISTS idx_llm_traces_user_org ON public.llm_traces(user_id, organization_id);

-- =====================================================
-- 21. GRANT NECESSARY PERMISSIONS
-- =====================================================

-- Revoke unnecessary permissions and grant minimal required
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Grant select permissions for authenticated users (RLS will filter)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- Grant insert/update/delete where appropriate (RLS will filter)
GRANT INSERT, UPDATE, DELETE ON public.mediar_users TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.low_level_workflows TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.low_level_events TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_activity_data TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.session_metadata TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.low_level_workflow_analyses TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.synthesis_sessions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.saved_workflow_syntheses TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.low_level_datasets TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.low_level_workflow_labeling TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.raw_timeline_event_annotations TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.agent_live_transcriptions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.workflow_steps TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.workflow_substeps TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.workflow_analysis_jobs TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.llm_traces TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.screenshot_processing_locks TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.deployed_workflows TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.workflow_executions TO authenticated;
GRANT INSERT, UPDATE ON public.access_requests TO authenticated;

-- Grant usage on sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- =====================================================
-- 22. ADD SECURITY AUDIT LOG TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.security_audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id TEXT,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on audit log
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs
CREATE POLICY "audit_admin_only" ON public.security_audit_log
    FOR SELECT USING (public.is_organization_admin());

-- Create index for audit log queries
CREATE INDEX idx_audit_log_user_id ON public.security_audit_log(user_id);
CREATE INDEX idx_audit_log_created_at ON public.security_audit_log(created_at);
CREATE INDEX idx_audit_log_action ON public.security_audit_log(action);

-- Grant permissions for audit log
GRANT SELECT ON public.security_audit_log TO authenticated;

-- =====================================================
-- 23. CREATE AUDIT TRIGGER FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.security_audit_log (
            user_id, action, table_name, record_id, metadata
        ) VALUES (
            auth.uid()::text, 
            'INSERT', 
            TG_TABLE_NAME, 
            NEW.id::text,
            jsonb_build_object('new', to_jsonb(NEW))
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.security_audit_log (
            user_id, action, table_name, record_id, metadata
        ) VALUES (
            auth.uid()::text, 
            'UPDATE', 
            TG_TABLE_NAME, 
            NEW.id::text,
            jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW))
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.security_audit_log (
            user_id, action, table_name, record_id, metadata
        ) VALUES (
            auth.uid()::text, 
            'DELETE', 
            TG_TABLE_NAME, 
            OLD.id::text,
            jsonb_build_object('old', to_jsonb(OLD))
        );
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 24. ADD AUDIT TRIGGERS TO SENSITIVE TABLES
-- =====================================================

-- Add audit triggers to sensitive tables
CREATE TRIGGER audit_mediar_users 
    AFTER INSERT OR UPDATE OR DELETE ON public.mediar_users 
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE TRIGGER audit_deployed_workflows 
    AFTER INSERT OR UPDATE OR DELETE ON public.deployed_workflows 
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE TRIGGER audit_workflow_executions 
    AFTER INSERT OR UPDATE OR DELETE ON public.workflow_executions 
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE TRIGGER audit_access_requests 
    AFTER INSERT OR UPDATE OR DELETE ON public.access_requests 
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- =====================================================
-- 25. COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON FUNCTION public.user_organization_id() IS 'Returns the organization ID of the current authenticated user';
COMMENT ON FUNCTION public.is_organization_admin() IS 'Checks if the current authenticated user is an organization admin';
COMMENT ON FUNCTION public.audit_trigger() IS 'Logs all data modifications to the security audit log';
COMMENT ON TABLE public.security_audit_log IS 'Audit log for tracking all data modifications for security and compliance';