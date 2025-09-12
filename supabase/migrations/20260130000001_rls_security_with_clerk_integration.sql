-- Migration: Comprehensive RLS Security with Clerk Integration
-- Created: 2026-01-30
-- Description: Enhanced Row Level Security policies that work with Clerk authentication

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
-- 2. CLERK JWT HELPER FUNCTIONS
-- =====================================================

-- Function to get Clerk user ID from JWT
CREATE OR REPLACE FUNCTION public.get_clerk_user_id()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
    SELECT COALESCE(
        current_setting('request.jwt.claims', true)::json->>'sub',
        current_setting('request.jwt.claims', true)::json->>'user_id',
        ''
    )::text;
$$;

-- Function to check if request is from service role (for API routes)
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT current_setting('request.jwt.claims', true)::json->>'role' = 'service_role';
$$;

-- Function to get user's organization from mediar_users table
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
    SELECT organization_id 
    FROM public.mediar_users 
    WHERE user_id = public.get_clerk_user_id()
    LIMIT 1;
$$;

-- Function to check if user is organization admin
CREATE OR REPLACE FUNCTION public.is_user_organization_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.mediar_users 
        WHERE user_id = public.get_clerk_user_id()
        AND role = 'admin'
    );
$$;

-- =====================================================
-- 3. MEDIAR USERS TABLE POLICIES (Clerk-aware)
-- =====================================================

-- Users can see their own profile or service role can see all
CREATE POLICY "users_profile_select_clerk" ON public.mediar_users
    FOR SELECT USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

-- Users can update their own profile or service role can update
CREATE POLICY "users_profile_update_clerk" ON public.mediar_users
    FOR UPDATE USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    )
    WITH CHECK (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

-- Users can insert their own profile or service role can insert
CREATE POLICY "users_profile_insert_clerk" ON public.mediar_users
    FOR INSERT WITH CHECK (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

-- =====================================================
-- 4. LOW LEVEL WORKFLOWS POLICIES (Clerk-aware)
-- =====================================================

-- Users can see their own workflows, org workflows, or service role sees all
CREATE POLICY "workflows_access_clerk" ON public.low_level_workflows
    FOR SELECT USING (
        user_id = public.get_clerk_user_id()
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.get_user_organization_id()
        )
        OR public.is_service_role()
    );

-- Users can insert their own workflows or service role can insert
CREATE POLICY "workflows_insert_clerk" ON public.low_level_workflows
    FOR INSERT WITH CHECK (
        (
            user_id = public.get_clerk_user_id()
            AND (
                organization_id IS NULL 
                OR organization_id = public.get_user_organization_id()
            )
        )
        OR public.is_service_role()
    );

-- Users can update their own workflows, org admins can update org workflows
CREATE POLICY "workflows_update_clerk" ON public.low_level_workflows
    FOR UPDATE USING (
        user_id = public.get_clerk_user_id()
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.get_user_organization_id()
            AND public.is_user_organization_admin()
        )
        OR public.is_service_role()
    );

-- Users can delete their own workflows, org admins can delete org workflows
CREATE POLICY "workflows_delete_clerk" ON public.low_level_workflows
    FOR DELETE USING (
        user_id = public.get_clerk_user_id()
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.get_user_organization_id()
            AND public.is_user_organization_admin()
        )
        OR public.is_service_role()
    );

-- =====================================================
-- 5. LOW LEVEL EVENTS POLICIES (Clerk-aware)
-- =====================================================

-- Users can access their own events or service role can access all
CREATE POLICY "events_access_clerk" ON public.low_level_events
    FOR SELECT USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "events_insert_clerk" ON public.low_level_events
    FOR INSERT WITH CHECK (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "events_update_clerk" ON public.low_level_events
    FOR UPDATE USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "events_delete_clerk" ON public.low_level_events
    FOR DELETE USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

-- =====================================================
-- 6. USER ACTIVITY DATA POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "activity_access_clerk" ON public.user_activity_data
    FOR SELECT USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "activity_insert_clerk" ON public.user_activity_data
    FOR INSERT WITH CHECK (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

-- =====================================================
-- 7. SESSION METADATA POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "session_access_clerk" ON public.session_metadata
    FOR SELECT USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "session_insert_clerk" ON public.session_metadata
    FOR INSERT WITH CHECK (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "session_update_clerk" ON public.session_metadata
    FOR UPDATE USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

-- =====================================================
-- 8. WORKFLOW ANALYSES POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "analysis_access_clerk" ON public.low_level_workflow_analyses
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = low_level_workflow_analyses.workflow_id
            AND (
                w.user_id = public.get_clerk_user_id()
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.get_user_organization_id()
                )
            )
        )
        OR public.is_service_role()
    );

CREATE POLICY "analysis_insert_clerk" ON public.low_level_workflow_analyses
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = workflow_id
            AND w.user_id = public.get_clerk_user_id()
        )
        OR public.is_service_role()
    );

-- =====================================================
-- 9. SYNTHESIS SESSIONS POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "synthesis_access_clerk" ON public.synthesis_sessions
    FOR SELECT USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "synthesis_insert_clerk" ON public.synthesis_sessions
    FOR INSERT WITH CHECK (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "synthesis_update_clerk" ON public.synthesis_sessions
    FOR UPDATE USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

-- =====================================================
-- 10. SAVED WORKFLOW SYNTHESES POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "saved_synthesis_access_clerk" ON public.saved_workflow_syntheses
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.synthesis_sessions s
            WHERE s.session_id = saved_workflow_syntheses.session_id
            AND s.user_id = public.get_clerk_user_id()
        )
        OR public.is_service_role()
    );

CREATE POLICY "saved_synthesis_insert_clerk" ON public.saved_workflow_syntheses
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.synthesis_sessions s
            WHERE s.session_id = session_id
            AND s.user_id = public.get_clerk_user_id()
        )
        OR public.is_service_role()
    );

-- =====================================================
-- 11. DATASETS POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "dataset_access_clerk" ON public.low_level_datasets
    FOR SELECT USING (
        organization_id = public.get_user_organization_id()
        OR (organization_id IS NULL AND created_by = public.get_clerk_user_id())
        OR public.is_service_role()
    );

CREATE POLICY "dataset_insert_clerk" ON public.low_level_datasets
    FOR INSERT WITH CHECK (
        (
            created_by = public.get_clerk_user_id()
            AND (
                organization_id IS NULL 
                OR organization_id = public.get_user_organization_id()
            )
        )
        OR public.is_service_role()
    );

CREATE POLICY "dataset_update_clerk" ON public.low_level_datasets
    FOR UPDATE USING (
        (organization_id = public.get_user_organization_id() AND public.is_user_organization_admin())
        OR (organization_id IS NULL AND created_by = public.get_clerk_user_id())
        OR public.is_service_role()
    );

-- =====================================================
-- 12. WORKFLOW LABELING POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "labeling_access_clerk" ON public.low_level_workflow_labeling
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = low_level_workflow_labeling.workflow_id
            AND (
                w.user_id = public.get_clerk_user_id()
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.get_user_organization_id()
                )
            )
        )
        OR public.is_service_role()
    );

CREATE POLICY "labeling_insert_clerk" ON public.low_level_workflow_labeling
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = workflow_id
            AND w.user_id = public.get_clerk_user_id()
        )
        OR public.is_service_role()
    );

CREATE POLICY "labeling_update_clerk" ON public.low_level_workflow_labeling
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = workflow_id
            AND (
                w.user_id = public.get_clerk_user_id()
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.get_user_organization_id()
                    AND public.is_user_organization_admin()
                )
            )
        )
        OR public.is_service_role()
    );

-- =====================================================
-- 13. TIMELINE ANNOTATIONS POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "annotations_access_clerk" ON public.raw_timeline_event_annotations
    FOR SELECT USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "annotations_insert_clerk" ON public.raw_timeline_event_annotations
    FOR INSERT WITH CHECK (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "annotations_update_clerk" ON public.raw_timeline_event_annotations
    FOR UPDATE USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "annotations_delete_clerk" ON public.raw_timeline_event_annotations
    FOR DELETE USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

-- =====================================================
-- 14. AGENT TRANSCRIPTIONS POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "transcription_access_clerk" ON public.agent_live_transcriptions
    FOR SELECT USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "transcription_insert_clerk" ON public.agent_live_transcriptions
    FOR INSERT WITH CHECK (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "transcription_update_clerk" ON public.agent_live_transcriptions
    FOR UPDATE USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

-- =====================================================
-- 15. WORKFLOW STEPS POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "steps_access_clerk" ON public.workflow_steps
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = workflow_steps.workflow_id
            AND (
                w.user_id = public.get_clerk_user_id()
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.get_user_organization_id()
                )
            )
        )
        OR public.is_service_role()
    );

CREATE POLICY "steps_insert_clerk" ON public.workflow_steps
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.low_level_workflows w
            WHERE w.id = workflow_id
            AND w.user_id = public.get_clerk_user_id()
        )
        OR public.is_service_role()
    );

-- =====================================================
-- 16. WORKFLOW SUBSTEPS POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "substeps_access_clerk" ON public.workflow_substeps
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.workflow_steps s
            JOIN public.low_level_workflows w ON w.id = s.workflow_id
            WHERE s.id = workflow_substeps.step_id
            AND (
                w.user_id = public.get_clerk_user_id()
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.get_user_organization_id()
                )
            )
        )
        OR public.is_service_role()
    );

CREATE POLICY "substeps_insert_clerk" ON public.workflow_substeps
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.workflow_steps s
            JOIN public.low_level_workflows w ON w.id = s.workflow_id
            WHERE s.id = step_id
            AND w.user_id = public.get_clerk_user_id()
        )
        OR public.is_service_role()
    );

-- =====================================================
-- 17. WORKFLOW ANALYSIS JOBS POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "jobs_access_clerk" ON public.workflow_analysis_jobs
    FOR SELECT USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "jobs_insert_clerk" ON public.workflow_analysis_jobs
    FOR INSERT WITH CHECK (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "jobs_update_clerk" ON public.workflow_analysis_jobs
    FOR UPDATE USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

-- =====================================================
-- 18. LLM TRACES POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "traces_access_clerk" ON public.llm_traces
    FOR SELECT USING (
        user_id = public.get_clerk_user_id()
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.get_user_organization_id()
            AND public.is_user_organization_admin()
        )
        OR public.is_service_role()
    );

CREATE POLICY "traces_insert_clerk" ON public.llm_traces
    FOR INSERT WITH CHECK (
        (
            user_id = public.get_clerk_user_id()
            AND (
                organization_id IS NULL 
                OR organization_id = public.get_user_organization_id()
            )
        )
        OR public.is_service_role()
    );

-- =====================================================
-- 19. SCREENSHOT LOCKS POLICIES (Clerk-aware)
-- =====================================================

CREATE POLICY "locks_access_clerk" ON public.screenshot_processing_locks
    FOR SELECT USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "locks_insert_clerk" ON public.screenshot_processing_locks
    FOR INSERT WITH CHECK (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "locks_update_clerk" ON public.screenshot_processing_locks
    FOR UPDATE USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "locks_delete_clerk" ON public.screenshot_processing_locks
    FOR DELETE USING (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

-- =====================================================
-- 20. IMPROVE DEPLOYED WORKFLOWS POLICIES (Clerk-aware)
-- =====================================================

-- Drop existing less secure policies if they exist
DROP POLICY IF EXISTS "Users can read active workflows" ON public.deployed_workflows;
DROP POLICY IF EXISTS "Authenticated users can create workflows" ON public.deployed_workflows;
DROP POLICY IF EXISTS "Users can update own workflows" ON public.deployed_workflows;
DROP POLICY IF EXISTS "Users can delete own workflows" ON public.deployed_workflows;

-- Add organization_id column if it doesn't exist
ALTER TABLE public.deployed_workflows 
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- Create Clerk-aware policies
CREATE POLICY "deployed_workflows_access_clerk" ON public.deployed_workflows
    FOR SELECT USING (
        status = 'active' 
        OR created_by::text = public.get_clerk_user_id()
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.get_user_organization_id()
        )
        OR public.is_service_role()
    );

CREATE POLICY "deployed_workflows_insert_clerk" ON public.deployed_workflows
    FOR INSERT WITH CHECK (
        (
            created_by::text = public.get_clerk_user_id()
            AND (
                organization_id IS NULL 
                OR organization_id = public.get_user_organization_id()
            )
        )
        OR public.is_service_role()
    );

CREATE POLICY "deployed_workflows_update_clerk" ON public.deployed_workflows
    FOR UPDATE USING (
        created_by::text = public.get_clerk_user_id()
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.get_user_organization_id()
            AND public.is_user_organization_admin()
        )
        OR public.is_service_role()
    );

CREATE POLICY "deployed_workflows_delete_clerk" ON public.deployed_workflows
    FOR DELETE USING (
        created_by::text = public.get_clerk_user_id()
        OR (
            organization_id IS NOT NULL 
            AND organization_id = public.get_user_organization_id()
            AND public.is_user_organization_admin()
        )
        OR public.is_service_role()
    );

-- =====================================================
-- 21. IMPROVE WORKFLOW EXECUTIONS POLICIES (Clerk-aware)
-- =====================================================

-- Drop existing less secure policies if they exist
DROP POLICY IF EXISTS "Clients can see own executions" ON public.workflow_executions;
DROP POLICY IF EXISTS "System can insert executions" ON public.workflow_executions;
DROP POLICY IF EXISTS "System can update executions" ON public.workflow_executions;

-- Add organization_id column if it doesn't exist
ALTER TABLE public.workflow_executions 
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- Create Clerk-aware policies
CREATE POLICY "executions_access_clerk" ON public.workflow_executions
    FOR SELECT USING (
        client_id = public.get_clerk_user_id()
        OR EXISTS (
            SELECT 1 FROM public.deployed_workflows w
            WHERE w.id = workflow_executions.workflow_id
            AND (
                w.created_by::text = public.get_clerk_user_id()
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.get_user_organization_id()
                )
            )
        )
        OR public.is_service_role()
    );

CREATE POLICY "executions_insert_clerk" ON public.workflow_executions
    FOR INSERT WITH CHECK (
        (
            client_id = public.get_clerk_user_id()
            OR EXISTS (
                SELECT 1 FROM public.deployed_workflows w
                WHERE w.id = workflow_id
                AND w.created_by::text = public.get_clerk_user_id()
            )
        )
        OR public.is_service_role()
    );

CREATE POLICY "executions_update_clerk" ON public.workflow_executions
    FOR UPDATE USING (
        client_id = public.get_clerk_user_id()
        OR EXISTS (
            SELECT 1 FROM public.deployed_workflows w
            WHERE w.id = workflow_id
            AND (
                w.created_by::text = public.get_clerk_user_id()
                OR (
                    w.organization_id IS NOT NULL 
                    AND w.organization_id = public.get_user_organization_id()
                    AND public.is_user_organization_admin()
                )
            )
        )
        OR public.is_service_role()
    );

-- =====================================================
-- 22. ACCESS REQUESTS POLICIES (Clerk-aware)
-- =====================================================

-- Update existing access_requests policies to work with Clerk
DROP POLICY IF EXISTS "Users can read their own access requests" ON public.access_requests;
DROP POLICY IF EXISTS "Users can create their own access requests" ON public.access_requests;
DROP POLICY IF EXISTS "Owners can read organization access requests" ON public.access_requests;
DROP POLICY IF EXISTS "Owners can update organization access requests" ON public.access_requests;

CREATE POLICY "access_requests_read_clerk" ON public.access_requests
    FOR SELECT USING (
        user_id = public.get_clerk_user_id()
        OR EXISTS (
            SELECT 1 FROM public.mediar_users 
            WHERE user_id = public.get_clerk_user_id()
            AND organization_id IS NOT NULL
        )
        OR public.is_service_role()
    );

CREATE POLICY "access_requests_insert_clerk" ON public.access_requests
    FOR INSERT WITH CHECK (
        user_id = public.get_clerk_user_id()
        OR public.is_service_role()
    );

CREATE POLICY "access_requests_update_clerk" ON public.access_requests
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.mediar_users 
            WHERE user_id = public.get_clerk_user_id()
            AND organization_id IS NOT NULL
        )
        OR public.is_service_role()
    );

-- =====================================================
-- 23. ADD MISSING COLUMNS FOR CONSISTENCY
-- =====================================================

ALTER TABLE public.llm_traces 
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

ALTER TABLE public.low_level_datasets 
    ADD COLUMN IF NOT EXISTS created_by TEXT;

-- =====================================================
-- 24. CREATE PERFORMANCE INDEXES
-- =====================================================

-- Create indexes for RLS policy performance with Clerk user IDs
CREATE INDEX IF NOT EXISTS idx_mediar_users_clerk ON public.mediar_users(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_user_clerk ON public.low_level_workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_org ON public.low_level_workflows(organization_id);
CREATE INDEX IF NOT EXISTS idx_events_user_clerk ON public.low_level_events(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_user_clerk ON public.user_activity_data(user_id);
CREATE INDEX IF NOT EXISTS idx_session_user_clerk ON public.session_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_created_by ON public.deployed_workflows(created_by);
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_org_clerk ON public.deployed_workflows(organization_id);
CREATE INDEX IF NOT EXISTS idx_executions_client_clerk ON public.workflow_executions(client_id);
CREATE INDEX IF NOT EXISTS idx_llm_traces_user_clerk ON public.llm_traces(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_traces_org ON public.llm_traces(organization_id);

-- =====================================================
-- 25. GRANT PERMISSIONS
-- =====================================================

-- Grant permissions to authenticated users (service role will have full access)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Grant limited permissions to authenticated users (Clerk JWT users)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Grant minimal permissions to anon (unauthenticated)
GRANT SELECT ON public.deployed_workflows TO anon; -- Only active workflows visible

-- =====================================================
-- 26. AUDIT LOG FOR CLERK USERS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.security_audit_log (
    id BIGSERIAL PRIMARY KEY,
    clerk_user_id TEXT,
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

-- Only admins and service role can view audit logs
CREATE POLICY "audit_admin_clerk" ON public.security_audit_log
    FOR SELECT USING (
        public.is_user_organization_admin()
        OR public.is_service_role()
    );

-- Create indexes for audit log
CREATE INDEX idx_audit_log_clerk_user ON public.security_audit_log(clerk_user_id);
CREATE INDEX idx_audit_log_created ON public.security_audit_log(created_at);

-- =====================================================
-- 27. AUDIT TRIGGER FOR CLERK
-- =====================================================

CREATE OR REPLACE FUNCTION public.audit_trigger_clerk()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.security_audit_log (
            clerk_user_id, action, table_name, record_id, metadata
        ) VALUES (
            public.get_clerk_user_id(), 
            'INSERT', 
            TG_TABLE_NAME, 
            NEW.id::text,
            jsonb_build_object('new', to_jsonb(NEW))
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.security_audit_log (
            clerk_user_id, action, table_name, record_id, metadata
        ) VALUES (
            public.get_clerk_user_id(), 
            'UPDATE', 
            TG_TABLE_NAME, 
            NEW.id::text,
            jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW))
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.security_audit_log (
            clerk_user_id, action, table_name, record_id, metadata
        ) VALUES (
            public.get_clerk_user_id(), 
            'DELETE', 
            TG_TABLE_NAME, 
            OLD.id::text,
            jsonb_build_object('old', to_jsonb(OLD))
        );
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add audit triggers to sensitive tables
CREATE TRIGGER audit_mediar_users_clerk 
    AFTER INSERT OR UPDATE OR DELETE ON public.mediar_users 
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_clerk();

CREATE TRIGGER audit_deployed_workflows_clerk 
    AFTER INSERT OR UPDATE OR DELETE ON public.deployed_workflows 
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_clerk();

CREATE TRIGGER audit_workflow_executions_clerk 
    AFTER INSERT OR UPDATE OR DELETE ON public.workflow_executions 
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_clerk();

CREATE TRIGGER audit_access_requests_clerk 
    AFTER INSERT OR UPDATE OR DELETE ON public.access_requests 
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_clerk();

-- =====================================================
-- 28. DOCUMENTATION COMMENTS
-- =====================================================

COMMENT ON FUNCTION public.get_clerk_user_id() IS 'Extracts Clerk user ID from JWT claims in the request';
COMMENT ON FUNCTION public.is_service_role() IS 'Checks if the request is using service role key (bypasses RLS)';
COMMENT ON FUNCTION public.get_user_organization_id() IS 'Returns the organization ID for the current Clerk user';
COMMENT ON FUNCTION public.is_user_organization_admin() IS 'Checks if the current Clerk user is an organization admin';
COMMENT ON FUNCTION public.audit_trigger_clerk() IS 'Logs all data modifications with Clerk user ID for security audit';
COMMENT ON TABLE public.security_audit_log IS 'Audit log tracking all data modifications by Clerk users';

-- =====================================================
-- 29. MIGRATION NOTES
-- =====================================================

-- This migration:
-- 1. Enables RLS on all tables that were missing it
-- 2. Creates Clerk-aware RLS policies that check JWT claims
-- 3. Allows service role to bypass all RLS (for API routes using service key)
-- 4. Implements proper user isolation based on Clerk user IDs
-- 5. Adds organization-based multi-tenancy support
-- 6. Creates audit logging for compliance
-- 7. Maintains backward compatibility with existing service role usage

-- IMPORTANT: After applying this migration:
-- 1. Ensure your Clerk JWT template includes 'sub' or 'user_id' claim
-- 2. Test that API routes using service keys still work
-- 3. Verify that client-side queries work with Clerk JWTs
-- 4. Consider gradually migrating API routes to use Clerk JWTs instead of service keys