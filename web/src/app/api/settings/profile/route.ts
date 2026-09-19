import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/server';
import { encryptPayload } from '@/lib/encryption';

export async function GET(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser(request);
    if (!user || !supabase) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    }

    let { data, error } = await supabase
      .from('users_profile')
      .select(
        'full_name, email, telegram_chat_id, telegram_enabled, telegram_bot_token_enc, subscription_status, external_uid'
      )
      .eq('id', user.id)
      .maybeSingle();

    // Graceful fallback while the external_uid migration has not been applied yet.
    if (error && error.message?.includes('external_uid')) {
      const fallback = await supabase
        .from('users_profile')
        .select(
          'full_name, email, telegram_chat_id, telegram_enabled, telegram_bot_token_enc, subscription_status'
        )
        .eq('id', user.id)
        .maybeSingle();
      data = fallback.data as unknown as typeof data;
      error = fallback.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      full_name: data?.full_name || '',
      email: data?.email || user.email || '',
      telegram_chat_id: data?.telegram_chat_id || '',
      telegram_enabled: Boolean(data?.telegram_enabled),
      has_telegram_token: Boolean(data?.telegram_bot_token_enc),
      subscription_status: data?.subscription_status || 'trial',
      external_uid: data?.external_uid || '',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to load profile' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser(request);
    if (!user || !supabase) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    }

    const body = await request.json();
    const fullName =
      typeof body.full_name === 'string' ? body.full_name.trim() : undefined;
    const chatId =
      typeof body.telegram_chat_id === 'string' ? body.telegram_chat_id.trim() : undefined;
    const telegramEnabled =
      typeof body.telegram_enabled === 'boolean' ? body.telegram_enabled : undefined;
    const clearToken = Boolean(body.clear_telegram_token);
    const newToken =
      typeof body.telegram_bot_token === 'string' ? body.telegram_bot_token.trim() : '';

    const updates: Record<string, unknown> = {};

    if (fullName !== undefined) {
      if (!fullName) {
        return NextResponse.json({ error: 'Display name cannot be empty.' }, { status: 400 });
      }
      updates.full_name = fullName;
    }

    if (chatId !== undefined) {
      updates.telegram_chat_id = chatId || null;
    }

    if (telegramEnabled !== undefined) {
      updates.telegram_enabled = telegramEnabled;
    }

    if (clearToken) {
      updates.telegram_bot_token_enc = null;
      updates.telegram_enabled = false;
    } else if (newToken) {
      updates.telegram_bot_token_enc = encryptPayload(newToken);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No changes provided.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('users_profile')
      .update(updates)
      .eq('id', user.id)
      .select('full_name, email, telegram_chat_id, telegram_enabled, telegram_bot_token_enc')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      full_name: data?.full_name || '',
      email: data?.email || user.email || '',
      telegram_chat_id: data?.telegram_chat_id || '',
      telegram_enabled: Boolean(data?.telegram_enabled),
      has_telegram_token: Boolean(data?.telegram_bot_token_enc),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update profile' },
      { status: 500 }
    );
  }
}
