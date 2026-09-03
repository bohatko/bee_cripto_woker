import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/server';
import { fetchLiveBalanceFromDecryptedAccount } from '@/lib/exchange-service';

export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser(request);
    if (!user || !supabase) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }

    // Fetch all active connected exchange accounts for this user
    const { data: accounts, error } = await supabase
      .from('exchange_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (error) {
      console.error('[SyncBalances] Error querying exchange accounts:', error);
      return NextResponse.json(
        { error: `Failed to load accounts: ${error.message}` },
        { status: 500 }
      );
    }

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({
        success: true,
        totalEquityUsd: 0,
        totalAvailableMarginUsd: 0,
        accounts: [],
        message: 'No active exchange accounts connected yet.',
      });
    }

    const updatedAccounts = [];
    let totalEquity = 0;
    let totalFreeMargin = 0;

    for (const acc of accounts) {
      const balanceResult = await fetchLiveBalanceFromDecryptedAccount(acc);

      if (balanceResult.error) {
        console.warn(`[SyncBalances] Balance sync warning for account ${acc.id} (${acc.exchange}):`, balanceResult.error);
        // Record sync error without zeroing out previous known balance
        await supabase
          .from('exchange_accounts')
          .update({
            last_error_msg: balanceResult.error,
            last_sync_at: new Date().toISOString(),
          })
          .eq('id', acc.id);

        const fallbackBalance = Number(acc.last_balance_usd) || 0;
        const fallbackFree = Number(acc.free_balance_usd ?? fallbackBalance * 0.75) || 0;
        totalEquity += fallbackBalance;
        totalFreeMargin += fallbackFree;

        updatedAccounts.push({
          ...acc,
          last_error_msg: balanceResult.error,
          free_balance_usd: fallbackFree,
          syncStatus: 'error',
        });
      } else {
        const liveTotal = balanceResult.total;
        const liveFree = balanceResult.free;

        await supabase
          .from('exchange_accounts')
          .update({
            last_balance_usd: liveTotal,
            free_balance_usd: liveFree,
            last_sync_at: new Date().toISOString(),
            last_error_msg: null,
            is_validated: true,
          })
          .eq('id', acc.id);

        totalEquity += liveTotal;
        totalFreeMargin += liveFree;

        updatedAccounts.push({
          ...acc,
          last_balance_usd: liveTotal,
          free_balance_usd: liveFree,
          last_error_msg: null,
          syncStatus: 'synced',
        });
      }
    }

    return NextResponse.json({
      success: true,
      totalEquityUsd: totalEquity,
      totalAvailableMarginUsd: totalFreeMargin,
      accounts: updatedAccounts,
      message: `Successfully refreshed balances for ${updatedAccounts.length} exchange(s).`,
    });
  } catch (err: any) {
    console.error('[SyncBalances] Unhandled error during sync:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error while syncing balances' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
