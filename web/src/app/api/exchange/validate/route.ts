import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/server';
import { validateExchangeViaWorker, WorkerConfigError } from '@/lib/worker-client';
import { encryptPayload, encryptString } from '@/lib/encryption';

export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser(request);
    if (!user || !supabase) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { exchange, apiKey, apiSecret, passphrase, accountName, isPrimary } = body;

    if (!exchange || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'Exchange, API Key, and API Secret are required.' },
        { status: 400 }
      );
    }

    if (!['binance', 'okx', 'bybit'].includes(exchange)) {
      return NextResponse.json(
        { error: 'Unsupported exchange. Supported: Binance, OKX, Bybit.' },
        { status: 400 }
      );
    }

    if (exchange === 'okx' && !passphrase) {
      return NextResponse.json(
        { error: 'OKX requires an API passphrase.' },
        { status: 400 }
      );
    }

    const { data: profile } = await supabase
      .from('users_profile')
      .select('subscription_plan, subscription_status')
      .eq('id', user.id)
      .maybeSingle();

    const extraExchangeRequiresPro =
      profile?.subscription_plan !== 'pro' || profile?.subscription_status === 'trial';

    if (extraExchangeRequiresPro) {
      const { data: existingAccounts, error: accountsError } = await supabase
        .from('exchange_accounts')
        .select('exchange')
        .eq('user_id', user.id);

      if (accountsError) {
        return NextResponse.json(
          { error: `Database error checking exchanges: ${accountsError.message}` },
          { status: 500 }
        );
      }

      const otherExchanges = (existingAccounts || []).filter((account) => account.exchange !== exchange);
      if (otherExchanges.length >= 1) {
        return NextResponse.json(
          { error: 'Lite and trial include one exchange. Upgrade to Pro to connect Binance, OKX and Bybit.' },
          { status: 403 }
        );
      }
    }

    // Live CCXT calls must run on the worker (static egress IP), not on Vercel.
    const validation = await validateExchangeViaWorker(
      exchange,
      apiKey.trim(),
      apiSecret.trim(),
      passphrase?.trim()
    );

    if (!validation.ok) {
      return NextResponse.json(
        {
          error: validation.error,
          canWithdraw: validation.canWithdraw,
        },
        { status: validation.status >= 400 && validation.status < 600 ? validation.status : 400 }
      );
    }

    const encKey = encryptString(apiKey.trim());
    const record = {
      user_id: user.id,
      exchange,
      account_name: accountName || `${exchange.toUpperCase()} Futures`,
      encrypted_api_key: encryptPayload(apiKey.trim()),
      encrypted_secret: encryptPayload(apiSecret.trim()),
      encrypted_passphrase: passphrase?.trim() ? encryptPayload(passphrase.trim()) : null,
      iv_nonce: encKey.iv,
      tag: encKey.tag,
      is_validated: true,
      can_withdraw: false,
      can_trade_futures: true,
      last_balance_usd: validation.data.totalBalanceUsd,
      free_balance_usd: validation.data.freeBalanceUsd,
      last_sync_at: new Date().toISOString(),
      last_error_msg: null,
      is_active: true,
    };

    const { data: savedAccount, error: saveError } = await supabase
      .from('exchange_accounts')
      .upsert(record, { onConflict: 'user_id, exchange' })
      .select()
      .single();

    if (saveError) {
      return NextResponse.json(
        { error: `Database error saving exchange: ${saveError.message}` },
        { status: 500 }
      );
    }

    const { data: settings } = await supabase
      .from('trading_settings')
      .select('id, exchange_account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    const shouldSetPrimary =
      isPrimary === true ||
      !settings ||
      !settings.exchange_account_id;

    if (savedAccount && shouldSetPrimary) {
      if (settings) {
        await supabase
          .from('trading_settings')
          .update({ exchange_account_id: savedAccount.id })
          .eq('user_id', user.id);
      } else {
        await supabase
          .from('trading_settings')
          .insert({
            user_id: user.id,
            exchange_account_id: savedAccount.id,
            is_bot_active: false,
            effective_leverage: 7.0,
          });
      }
    }

    return NextResponse.json({
      success: true,
      exchange,
      balanceUsd: validation.data.totalBalanceUsd,
      freeBalanceUsd: validation.data.freeBalanceUsd,
      account: savedAccount,
      message: `Successfully connected to ${exchange.toUpperCase()}! Verified live balance: $${validation.data.totalBalanceUsd.toFixed(
        2
      )} USDT`,
    });
  } catch (err: any) {
    if (err instanceof WorkerConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: err.message || 'Internal server error while validating exchange keys' },
      { status: 500 }
    );
  }
}
