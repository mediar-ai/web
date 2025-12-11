-- Create user_credits table for tracking user credit balances
CREATE TABLE IF NOT EXISTS public.user_credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL UNIQUE,
    balance INTEGER NOT NULL DEFAULT 0,
    lifetime_earned INTEGER NOT NULL DEFAULT 0,
    lifetime_spent INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create credit_transactions table for audit trail
CREATE TABLE IF NOT EXISTS public.credit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL, -- positive for credits, negative for debits
    type TEXT NOT NULL, -- 'purchase', 'vm_launch', 'vm_hourly', 'refund', 'bonus', 'onboarding'
    description TEXT,
    reference_id TEXT, -- stripe_session_id, machine_id, etc.
    balance_after INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON public.user_credits(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON public.credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON public.credit_transactions(type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON public.credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_reference_id ON public.credit_transactions(reference_id);

-- Add RLS policies
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role can manage user_credits"
    ON public.user_credits
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage credit_transactions"
    ON public.credit_transactions
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Create function to add credits (atomic operation)
CREATE OR REPLACE FUNCTION add_credits(
    p_user_id TEXT,
    p_amount INTEGER,
    p_type TEXT,
    p_description TEXT DEFAULT NULL,
    p_reference_id TEXT DEFAULT NULL
) RETURNS TABLE(new_balance INTEGER, transaction_id UUID) AS $$
DECLARE
    v_new_balance INTEGER;
    v_transaction_id UUID;
BEGIN
    -- Upsert user_credits record
    INSERT INTO public.user_credits (user_id, balance, lifetime_earned, updated_at)
    VALUES (p_user_id, p_amount, GREATEST(p_amount, 0), NOW())
    ON CONFLICT (user_id) DO UPDATE SET
        balance = user_credits.balance + p_amount,
        lifetime_earned = CASE WHEN p_amount > 0 THEN user_credits.lifetime_earned + p_amount ELSE user_credits.lifetime_earned END,
        lifetime_spent = CASE WHEN p_amount < 0 THEN user_credits.lifetime_spent + ABS(p_amount) ELSE user_credits.lifetime_spent END,
        updated_at = NOW()
    RETURNING balance INTO v_new_balance;

    -- Insert transaction record
    INSERT INTO public.credit_transactions (user_id, amount, type, description, reference_id, balance_after)
    VALUES (p_user_id, p_amount, p_type, p_description, p_reference_id, v_new_balance)
    RETURNING id INTO v_transaction_id;

    RETURN QUERY SELECT v_new_balance, v_transaction_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to deduct credits (with validation)
CREATE OR REPLACE FUNCTION deduct_credits(
    p_user_id TEXT,
    p_amount INTEGER,
    p_type TEXT,
    p_description TEXT DEFAULT NULL,
    p_reference_id TEXT DEFAULT NULL
) RETURNS TABLE(success BOOLEAN, new_balance INTEGER, transaction_id UUID, error_message TEXT) AS $$
DECLARE
    v_current_balance INTEGER;
    v_new_balance INTEGER;
    v_transaction_id UUID;
BEGIN
    -- Get current balance with row lock
    SELECT balance INTO v_current_balance
    FROM public.user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;

    -- Check if user has credits record
    IF v_current_balance IS NULL THEN
        RETURN QUERY SELECT FALSE, 0, NULL::UUID, 'User has no credits'::TEXT;
        RETURN;
    END IF;

    -- Check if sufficient balance
    IF v_current_balance < p_amount THEN
        RETURN QUERY SELECT FALSE, v_current_balance, NULL::UUID, 'Insufficient credits'::TEXT;
        RETURN;
    END IF;

    -- Deduct credits
    UPDATE public.user_credits
    SET balance = balance - p_amount,
        lifetime_spent = lifetime_spent + p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING balance INTO v_new_balance;

    -- Insert transaction record
    INSERT INTO public.credit_transactions (user_id, amount, type, description, reference_id, balance_after)
    VALUES (p_user_id, -p_amount, p_type, p_description, p_reference_id, v_new_balance)
    RETURNING id INTO v_transaction_id;

    RETURN QUERY SELECT TRUE, v_new_balance, v_transaction_id, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Create function to get user balance
CREATE OR REPLACE FUNCTION get_user_credits(p_user_id TEXT)
RETURNS TABLE(balance INTEGER, lifetime_earned INTEGER, lifetime_spent INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT uc.balance, uc.lifetime_earned, uc.lifetime_spent
    FROM public.user_credits uc
    WHERE uc.user_id = p_user_id;

    -- Return zeros if no record exists
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 0, 0;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE public.user_credits IS 'Tracks user credit balances for VM launches and other services';
COMMENT ON TABLE public.credit_transactions IS 'Audit trail for all credit transactions';
