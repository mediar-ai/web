-- Create mediar_app_credits_purchase table for tracking Stripe payments
CREATE TABLE IF NOT EXISTS public.mediar_app_credits_purchase (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    stripe_session_id TEXT NOT NULL UNIQUE,
    stripe_payment_intent TEXT,
    purchase_token TEXT NOT NULL UNIQUE,
    paid_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_mediar_app_credits_purchase_user_id ON public.mediar_app_credits_purchase(user_id);
CREATE INDEX IF NOT EXISTS idx_mediar_app_credits_purchase_email ON public.mediar_app_credits_purchase(email);
CREATE INDEX IF NOT EXISTS idx_mediar_app_credits_purchase_purchase_token ON public.mediar_app_credits_purchase(purchase_token);

-- Add RLS policies
ALTER TABLE public.mediar_app_credits_purchase ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role can manage mediar_app_credits_purchase"
    ON public.mediar_app_credits_purchase
    FOR ALL
    USING (true)
    WITH CHECK (true);

COMMENT ON TABLE public.mediar_app_credits_purchase IS 'Tracks Stripe purchases for Mediar desktop app licenses';
