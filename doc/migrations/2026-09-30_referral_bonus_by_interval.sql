-- Partner bonus depends on the invitee's first Pro payment: $50 for a monthly plan, $300 for a yearly plan. Paid once per invitee.
ALTER TABLE public.referral_attributions DROP CONSTRAINT IF EXISTS referral_attributions_reward_amount;
ALTER TABLE public.referral_attributions
    ADD CONSTRAINT referral_attributions_reward_amount CHECK (reward_usd IS NULL OR reward_usd IN (50, 300));

CREATE OR REPLACE FUNCTION public.credit_referral_subscription_bonus(p_invoice_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    invoice_row public.invoices%ROWTYPE;
    attribution_id UUID;
    bonus NUMERIC;
BEGIN
    SELECT * INTO invoice_row
    FROM public.invoices
    WHERE id = p_invoice_id AND status = 'paid';

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    IF COALESCE(invoice_row.total_amount_usd, 0) < 200
       OR COALESCE(invoice_row.subscription_plan, '') <> 'pro' THEN
        RETURN 0;
    END IF;

    bonus := CASE invoice_row.billing_interval
        WHEN 'month' THEN 50
        WHEN 'year' THEN 300
        ELSE 0
    END;

    IF bonus = 0 THEN
        RETURN 0;
    END IF;

    UPDATE public.referral_attributions
    SET reward_usd = bonus,
        rewarded_at = NOW(),
        rewarded_invoice_id = invoice_row.id
    WHERE invitee_user_id = invoice_row.user_id
      AND rewarded_at IS NULL
    RETURNING id INTO attribution_id;

    IF attribution_id IS NULL THEN
        RETURN 0;
    END IF;

    RETURN bonus;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_referral_subscription_bonus(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_referral_subscription_bonus(UUID) TO service_role, postgres;
