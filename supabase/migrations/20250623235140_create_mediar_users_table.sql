CREATE TABLE public.mediar_users (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  clerk_user_id text NOT NULL,
  email text,
  role text DEFAULT 'viewer'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT mediar_users_pkey PRIMARY KEY (id),
  CONSTRAINT mediar_users_clerk_user_id_key UNIQUE (clerk_user_id)
);

-- Add comments to the table and columns for clarity
COMMENT ON TABLE public.mediar_users IS 'Stores user information for dashboard viewers, linked to Clerk accounts.';
COMMENT ON COLUMN public.mediar_users.clerk_user_id IS 'The user ID from the Clerk authentication service.';
COMMENT ON COLUMN public.mediar_users.role IS 'The access role of the user (e.g., admin, viewer).';
