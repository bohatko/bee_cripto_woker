import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/server';
import { decryptString } from '@/lib/encryption';

function parseChatIds(raw: string | null | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser(request);
    if (!user || !supabase) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const overrideToken =
      typeof body.telegram_bot_token === 'string' ? body.telegram_bot_token.trim() : '';
    const overrideChatId =
      typeof body.telegram_chat_id === 'string' ? body.telegram_chat_id.trim() : '';

    let token = overrideToken;
    let chatIds = parseChatIds(overrideChatId);

    if (!token || chatIds.length === 0) {
      const { data, error } = await supabase
        .from('users_profile')
        .select('telegram_bot_token_enc, telegram_chat_id')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (!token) {
        if (!data?.telegram_bot_token_enc) {
          return NextResponse.json(
            { error: 'Telegram bot token is not configured.' },
            { status: 400 }
          );
        }
        try {
          token = decryptString(data.telegram_bot_token_enc);
        } catch {
          return NextResponse.json(
            { error: 'Failed to decrypt stored Telegram bot token.' },
            { status: 500 }
          );
        }
      }

      if (chatIds.length === 0) {
        chatIds = parseChatIds(data?.telegram_chat_id);
      }
    }

    if (!token || chatIds.length === 0) {
      return NextResponse.json(
        { error: 'Bot token and at least one Chat ID are required.' },
        { status: 400 }
      );
    }

    const text =
      '🐝 <b>Bee Crypto</b>\nTelegram connected successfully. Trade alerts will arrive here.';
    const failures: string[] = [];

    for (const chatId of chatIds) {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        failures.push(`${chatId}: ${JSON.stringify(errData)}`);
      }
    }

    if (failures.length > 0) {
      return NextResponse.json(
        {
          error: 'Failed to send test message to one or more chats.',
          details: failures,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, sent_to: chatIds.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Telegram test failed' },
      { status: 500 }
    );
  }
}
