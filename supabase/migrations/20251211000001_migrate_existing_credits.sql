-- Migrate existing credits from desktop app purchases and onboarding to new user_credits system
-- Run this ONCE after deploying the user_credits tables

-- Step 1: Credit users who bought the desktop app
-- Uses best rate: 15 credits per dollar (matching Pro package rate)
INSERT INTO public.user_credits (user_id, balance, lifetime_earned, updated_at)
SELECT
  user_id,
  FLOOR(SUM(price) * 15)::INTEGER as balance,
  FLOOR(SUM(price) * 15)::INTEGER as lifetime_earned,
  NOW()
FROM public.mediar_app_credits_purchase
WHERE user_id IS NOT NULL AND price > 0
GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE SET
  balance = user_credits.balance + EXCLUDED.balance,
  lifetime_earned = user_credits.lifetime_earned + EXCLUDED.lifetime_earned,
  updated_at = NOW();

-- Record transactions for audit trail (desktop app purchases)
INSERT INTO public.credit_transactions (user_id, amount, type, description, reference_id, balance_after, created_at)
SELECT
  p.user_id,
  FLOOR(p.price * 15)::INTEGER as amount,
  'app_purchase' as type,
  'Desktop app purchase ($' || p.price || ') - migrated' as description,
  p.stripe_session_id as reference_id,
  COALESCE((SELECT balance FROM public.user_credits WHERE user_id = p.user_id), 0) as balance_after,
  p.paid_at
FROM public.mediar_app_credits_purchase p
WHERE p.user_id IS NOT NULL AND p.price > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.credit_transactions t
    WHERE t.reference_id = p.stripe_session_id
  );

-- Step 2: Credit users from onboarding activities
INSERT INTO public.user_credits (user_id, balance, lifetime_earned, updated_at)
SELECT
  user_id,
  total_credits_earned,
  total_credits_earned,
  NOW()
FROM public.user_onboarding
WHERE user_id IS NOT NULL AND total_credits_earned > 0
ON CONFLICT (user_id) DO UPDATE SET
  balance = user_credits.balance + EXCLUDED.balance,
  lifetime_earned = user_credits.lifetime_earned + EXCLUDED.lifetime_earned,
  updated_at = NOW();

-- Record transactions for onboarding (single consolidated entry per user)
INSERT INTO public.credit_transactions (user_id, amount, type, description, reference_id, balance_after, created_at)
SELECT
  o.user_id,
  o.total_credits_earned as amount,
  'onboarding' as type,
  'Onboarding credits - migrated' as description,
  'onboarding-migration-' || o.user_id as reference_id,
  COALESCE((SELECT balance FROM public.user_credits WHERE user_id = o.user_id), 0) as balance_after,
  COALESCE(o.onboarding_completed_at, o.created_at, NOW())
FROM public.user_onboarding o
WHERE o.user_id IS NOT NULL AND o.total_credits_earned > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.credit_transactions t
    WHERE t.reference_id = 'onboarding-migration-' || o.user_id
  );

-- Log migration results
DO $$
DECLARE
  purchase_users INTEGER;
  onboarding_users INTEGER;
  total_credits INTEGER;
BEGIN
  SELECT COUNT(DISTINCT user_id) INTO purchase_users FROM public.mediar_app_credits_purchase WHERE price > 0;
  SELECT COUNT(DISTINCT user_id) INTO onboarding_users FROM public.user_onboarding WHERE total_credits_earned > 0;
  SELECT COALESCE(SUM(balance), 0) INTO total_credits FROM public.user_credits;

  RAISE NOTICE 'Migration complete: % purchase users, % onboarding users, % total credits distributed',
    purchase_users, onboarding_users, total_credits;
END $$;
