import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/server';
import {
  validateAndFetchExchangeBalance,
  SupportedExchange,
} from '@/lib/exchange-service';
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

    // 1. Live CCXT connection, permission audit, and balance query
    const validation = await validateAndFetchExchangeBalance(
      exchange as SupportedExchange,
      apiKey.trim(),
      apiSecret.trim(),
      passphrase?.trim()
    );

    if (!validation.isValid) {
      return NextResponse.json(
        {
          error: validation.errorMessage || 'Failed to authenticate with exchange API',
          canWithdraw: validation.canWithdraw,
        },
        { status: 400 }
      );
    }

    // 2. High-grade AES-256-GCM encryption with fresh IV & Tag per field
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
      last_balance_usd: validation.totalBalanceUsd,
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

    // Link account to trading_settings if currently empty or explicitly requested as primary
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
      balanceUsd: validation.totalBalanceUsd,
      freeBalanceUsd: validation.freeBalanceUsd,
      account: savedAccount,
      message: `Successfully connected to ${exchange.toUpperCase()}! Verified live balance: $${validation.totalBalanceUsd.toFixed(
        2
      )} USDT`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error while validating exchange keys' },
      { status: 500 }
    );
  }
}
