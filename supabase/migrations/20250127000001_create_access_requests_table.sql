-- Create access_requests table for email-based organization access requests
CREATE TABLE IF NOT EXISTS public.access_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id text NOT NULL,
    user_email text NOT NULL,
    user_name text,
    owner_email text NOT NULL,
    organization_id text,
    organization_name text,
    message text,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    processed_by text,
    
    -- Constraints
    CONSTRAINT access_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- Add RLS (Row Level Security) policies
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own requests
CREATE POLICY "Users can read their own access requests" ON public.access_requests
    FOR SELECT USING (auth.uid()::text = user_id);

-- Policy: Users can create their own requests  
CREATE POLICY "Users can create their own access requests" ON public.access_requests
    FOR INSERT WITH CHECK (auth.uid()::text = user_id);

-- Policy: Organization owners/admins can read requests for their organization
CREATE POLICY "Owners can read organization access requests" ON public.access_requests
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.mediar_users 
            WHERE user_id = auth.uid()::text 
            AND organization_id IS NOT NULL
        )
    );

-- Policy: Organization owners/admins can update requests for their organization
CREATE POLICY "Owners can update organization access requests" ON public.access_requests
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.mediar_users 
            WHERE user_id = auth.uid()::text 
            AND organization_id IS NOT NULL
        )
    );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON public.access_requests(status);
CREATE INDEX IF NOT EXISTS idx_access_requests_owner_email ON public.access_requests(owner_email);
CREATE INDEX IF NOT EXISTS idx_access_requests_user_id ON public.access_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_requested_at ON public.access_requests(requested_at);

-- Grant necessary permissions
GRANT ALL ON public.access_requests TO postgres;
GRANT SELECT, INSERT, UPDATE ON public.access_requests TO anon;
GRANT SELECT, INSERT, UPDATE ON public.access_requests TO authenticated;