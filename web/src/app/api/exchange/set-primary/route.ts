import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/server';

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
    const { accountId } = body;

    // Case 1: Disable trading on all accounts
    if (!accountId) {
      const { error: updateError } = await supabase
        .from('trading_settings')
        .update({
          exchange_account_id: null,
          is_bot_active: false,
        })
        .eq('user_id', user.id);

      if (updateError) {
        return NextResponse.json(
          { error: `Failed to update trading settings: ${updateError.message}` },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        exchangeAccountId: null,
        message: 'Bot trading disabled on all exchanges.',
      });
    }

    // Case 2: Set specific account as primary trading account
    const { data: account, error: accError } = await supabase
      .from('exchange_accounts')
      .select('id, exchange, account_name, is_validated, is_active')
      .eq('id', accountId)
      .eq('user_id', user.id)
      .single();

    if (accError || !account) {
      return NextResponse.json(
        { error: 'Exchange account not found or does not belong to you.' },
        { status: 404 }
      );
    }

    if (!account.is_validated) {
      return NextResponse.json(
        { error: 'This exchange account is not validated. Reconnect credentials first.' },
        { status: 400 }
      );
    }

    // Upsert trading_settings for user
    const { data: existingSettings } = await supabase
      .from('trading_settings')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingSettings) {
      const { error: updErr } = await supabase
        .from('trading_settings')
        .update({ exchange_account_id: account.id })
        .eq('user_id', user.id);

      if (updErr) {
        return NextResponse.json(
          { error: `Database error: ${updErr.message}` },
          { status: 500 }
        );
      }
    } else {
      const { error: insErr } = await supabase
        .from('trading_settings')
        .insert({
          user_id: user.id,
          exchange_account_id: account.id,
          is_bot_active: false,
          effective_leverage: 7.0,
        });

      if (insErr) {
        return NextResponse.json(
          { error: `Database error: ${insErr.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      exchangeAccountId: account.id,
      exchange: account.exchange,
      accountName: account.account_name,
      message: `${account.exchange.toUpperCase()} is now your active trading exchange!`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error while setting primary trading exchange' },
      { status: 500 }
    );
  }
}
