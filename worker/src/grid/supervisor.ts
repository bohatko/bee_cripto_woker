import { supabase } from '../config.js';
import { decryptString } from '../security/encryption.js';
import { telegramNotifier } from '../notifications/telegram.js';
import { scanGridCandidates } from './screener.js';
import { createOkxGrid, readOkxGrid, stopOkxGrid } from './okx-grid.js';
import { createBybitGrid, readBybitGrid, stopBybitGrid } from './bybit-grid.js';
import type { GridOrderParams } from './okx-grid.js';

const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface ProfileRow {
  id: string;
  email: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  is_frozen: boolean | null;
}

interface AccountRow {
  id: string;
  user_id: string;
  exchange: string;
  is_active: boolean;
  is_validated: boolean;
  can_withdraw: boolean;
  encrypted_api_key: string;
  encrypted_secret: string;
  encrypted_passphrase: string | null;
  iv_nonce: string | null;
  tag: string | null;
}

interface TemplateRow {
  id: string;
  base_asset: string;
  lower_price: number;
  upper_price: number;
  grid_count: number;
  spacing: 'geometric' | 'arithmetic';
  leverage: number;
  stop_price: number;
  take_profit_price: number;
  direction: 'neutral' | 'long' | 'short';
  params_hash: string;
}

interface SettingsRow {
  user_id: string;
  margin_usdt: number;
  exchange: 'okx' | 'bybit' | null;
  is_enabled: boolean;
  last_error?: string | null;
}

interface BotRow {
  id: string;
  user_id: string;
  template_id: string | null;
  exchange_account_id: string | null;
  exchange: 'okx' | 'bybit';
  exchange_bot_id: string | null;
  margin_usdt: number;
  params_hash: string;
  control_status: 'controlled' | 'released';
  run_status: 'starting' | 'running' | 'stopped' | 'error';
  base_asset?: string;
}

function entitled(profile: ProfileRow | undefined): boolean {
  if (!profile || profile.is_frozen) return false;
  if (profile.subscription_plan !== 'pro') return false;
  return profile.subscription_status === 'trial' || profile.subscription_status === 'active';
}

function credsOf(account: AccountRow): { apiKey: string; secret: string; passphrase: string } {
  return {
    apiKey: decryptString(account.encrypted_api_key, account.iv_nonce ?? undefined, account.tag ?? undefined),
    secret: decryptString(account.encrypted_secret, account.iv_nonce ?? undefined, account.tag ?? undefined),
    passphrase: account.encrypted_passphrase
      ? decryptString(account.encrypted_passphrase, account.iv_nonce ?? undefined, account.tag ?? undefined)
      : '',
  };
}

function orderParams(template: TemplateRow, margin: number): GridOrderParams {
  return {
    baseAsset: template.base_asset,
    lowerPrice: Number(template.lower_price),
    upperPrice: Number(template.upper_price),
    gridCount: Number(template.grid_count),
    leverage: Number(template.leverage),
    stopPrice: Number(template.stop_price),
    takeProfitPrice: Number(template.take_profit_price),
    spacing: template.spacing,
    direction: template.direction,
    marginUsdt: Number(margin),
  };
}

async function markBot(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('grid_bots').update(patch).eq('id', id);
  if (error) console.error(`[Grid] Failed to update bot ${id}: ${error.message}`);
}

async function closeOnExchange(bot: BotRow, account: AccountRow, baseAsset: string): Promise<void> {
  if (!bot.exchange_bot_id) return;
  const creds = credsOf(account);
  if (bot.exchange === 'okx') {
    if (!creds.passphrase) throw new Error('OKX passphrase is missing');
    await stopOkxGrid(creds, baseAsset, bot.exchange_bot_id);
    return;
  }
  await stopBybitGrid(creds, bot.exchange_bot_id);
}

export class GridSupervisor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly intervalMs = 30_000) {}

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    console.log('▦ Grid supervisor started.');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (err: any) {
      console.error(`[Grid] Supervisor tick failed: ${err?.message || err}`);
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    await this.maybeScan();

    const { data: template } = await supabase
      .from('grid_templates')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();
    const active = (template || null) as TemplateRow | null;

    const { data: liveRows } = await supabase
      .from('grid_bots')
      .select('*')
      .in('run_status', ['starting', 'running']);
    const live = (liveRows || []) as BotRow[];
    const skipStart = new Set<string>();

    const { data: settingRows } = await supabase.from('grid_user_settings').select('*');
    const settings = (settingRows || []) as SettingsRow[];
    const settingsByUser = new Map(settings.map((row) => [row.user_id, row]));

    const userIds = Array.from(new Set([...live.map((b) => b.user_id), ...settings.filter((s) => s.is_enabled).map((s) => s.user_id)]));
    if (userIds.length === 0) return;

    const [{ data: profiles }, { data: accounts }, { data: trading }] = await Promise.all([
      supabase
        .from('users_profile')
        .select('id, email, subscription_status, subscription_plan, is_frozen')
        .in('id', userIds),
      supabase
        .from('exchange_accounts')
        .select('id, user_id, exchange, is_active, is_validated, can_withdraw, encrypted_api_key, encrypted_secret, encrypted_passphrase, iv_nonce, tag')
        .in('user_id', userIds),
      supabase.from('trading_settings').select('user_id, exchange_account_id').in('user_id', userIds),
    ]);

    const profileById = new Map(((profiles || []) as ProfileRow[]).map((row) => [row.id, row]));
    const accountsByUser = new Map<string, AccountRow[]>();
    for (const account of (accounts || []) as AccountRow[]) {
      const list = accountsByUser.get(account.user_id) || [];
      list.push(account);
      accountsByUser.set(account.user_id, list);
    }
    const primaryByUser = new Map(
      ((trading || []) as { user_id: string; exchange_account_id: string | null }[]).map((row) => [
        row.user_id,
        row.exchange_account_id,
      ])
    );
    const templateIds = Array.from(new Set(live.map((b) => b.template_id).filter(Boolean))) as string[];
    const templateById = new Map<string, TemplateRow>();
    if (active) templateById.set(active.id, active);
    if (templateIds.length) {
      const { data: oldTemplates } = await supabase.from('grid_templates').select('*').in('id', templateIds);
      for (const row of (oldTemplates || []) as TemplateRow[]) templateById.set(row.id, row);
    }

    for (const bot of live) {
      const profile = profileById.get(bot.user_id);
      const setting = settingsByUser.get(bot.user_id);
      const account = (accountsByUser.get(bot.user_id) || []).find((row) => row.id === bot.exchange_account_id);
      const botTemplate = bot.template_id ? templateById.get(bot.template_id) : undefined;

      if (!entitled(profile)) {
        if (bot.control_status === 'controlled') {
          await markBot(bot.id, {
            control_status: 'released',
            released_notified_at: new Date().toISOString(),
          });
          await telegramNotifier.sendToUser(
            bot.user_id,
            'Grid bot is no longer controlled by Crypto Bee. It keeps running on the exchange. Renew Pro to resume control.'
          );
          console.log(`[Grid] Released control for ${profile?.email || bot.user_id}`);
        }
        continue;
      }

      if (bot.control_status === 'released') {
        await markBot(bot.id, { control_status: 'controlled', released_notified_at: null });
        bot.control_status = 'controlled';
      }

      const shouldStop =
        !setting?.is_enabled ||
        !active ||
        bot.template_id !== active.id ||
        bot.params_hash !== active.params_hash ||
        Number(bot.margin_usdt) !== Number(setting.margin_usdt);

      if (shouldStop) {
        if (!account || !botTemplate) {
          await markBot(bot.id, {
            run_status: 'error',
            last_error: 'Missing exchange account or template for a controlled grid.',
          });
          continue;
        }
        try {
          await closeOnExchange(bot, account, botTemplate.base_asset);
          await markBot(bot.id, {
            run_status: 'stopped',
            stop_reason: !setting?.is_enabled ? 'user' : 'rotation',
            stopped_at: new Date().toISOString(),
            last_error: null,
          });
          console.log(`[Grid] Stopped ${bot.exchange} bot ${bot.exchange_bot_id} for ${profile?.email || bot.user_id}`);
        } catch (err: any) {
          skipStart.add(bot.user_id);
          await markBot(bot.id, { last_error: err?.message || String(err) });
          console.error(`[Grid] Stop failed for ${bot.id}: ${err?.message || err}`);
        }
        continue;
      }

      if (account && bot.exchange_bot_id && botTemplate) {
        try {
          const creds = credsOf(account);
          const snap =
            bot.exchange === 'okx'
              ? await readOkxGrid(creds, bot.exchange_bot_id)
              : await readBybitGrid(creds, bot.exchange_bot_id);
          await markBot(bot.id, {
            run_status: snap.running ? 'running' : 'stopped',
            pnl_usdt: snap.pnlUsdt,
            snapshot: snap.raw,
            last_error: null,
            ...(snap.running ? {} : { stop_reason: 'exchange', stopped_at: new Date().toISOString() }),
          });
          if (!snap.running && setting?.is_enabled) {
            await supabase.from('grid_user_settings').update({ is_enabled: false }).eq('user_id', bot.user_id);
            setting.is_enabled = false;
          }
        } catch (err: any) {
          await markBot(bot.id, { last_error: err?.message || String(err) });
        }
      }
    }

    if (!active) return;

    for (const setting of settings) {
      if (!setting.is_enabled) continue;
      if (skipStart.has(setting.user_id)) continue;
      if (!entitled(profileById.get(setting.user_id))) continue;
      const stillLive = live.some(
        (bot) =>
          bot.user_id === setting.user_id &&
          bot.template_id === active.id &&
          bot.params_hash === active.params_hash &&
          Number(bot.margin_usdt) === Number(setting.margin_usdt)
      );
      if (stillLive) continue;

      const resolved = resolveAccount(setting, accountsByUser.get(setting.user_id) || [], primaryByUser.get(setting.user_id) || null);
      if ('error' in resolved) {
        if (setting.last_error !== resolved.error) {
          await supabase.from('grid_user_settings').update({ last_error: resolved.error }).eq('user_id', setting.user_id);
        }
        console.log(`[Grid] ${profileById.get(setting.user_id)?.email || setting.user_id}: ${resolved.error}`);
        continue;
      }
      if (Number(setting.margin_usdt) < 10) continue;

      try {
        const creds = credsOf(resolved.account);
        const params = orderParams(active, Number(setting.margin_usdt));
        const exchangeBotId =
          resolved.account.exchange === 'okx'
            ? await createOkxGrid(creds, params)
            : await createBybitGrid(creds, params);
        const { error } = await supabase.from('grid_bots').insert({
          user_id: setting.user_id,
          template_id: active.id,
          exchange_account_id: resolved.account.id,
          exchange: resolved.account.exchange,
          exchange_bot_id: exchangeBotId,
          margin_usdt: setting.margin_usdt,
          params_hash: active.params_hash,
          control_status: 'controlled',
          run_status: 'running',
          started_at: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        await supabase.from('grid_user_settings').update({ last_error: null }).eq('user_id', setting.user_id);
        console.log(`[Grid] Started ${resolved.account.exchange} ${active.base_asset} for ${profileById.get(setting.user_id)?.email || setting.user_id}`);
      } catch (err: any) {
        const message = err?.message || String(err);
        console.error(`[Grid] Start failed for ${setting.user_id}: ${message}`);
        await supabase.from('grid_user_settings').update({ last_error: message }).eq('user_id', setting.user_id);
      }
    }
  }

  private async maybeScan(): Promise<void> {
    const { data: engine } = await supabase.from('grid_engine').select('*').eq('id', 1).maybeSingle();
    if (!engine) return;
    const due = !engine.last_scan_at || Date.now() - new Date(engine.last_scan_at).getTime() > SCAN_INTERVAL_MS;
    if (!engine.scan_requested && !due) return;

    try {
      const candidates = await scanGridCandidates();
      await supabase.from('grid_screener_runs').insert({ candidates });
      await supabase
        .from('grid_engine')
        .update({ scan_requested: false, last_scan_at: new Date().toISOString(), last_scan_error: null })
        .eq('id', 1);
      console.log(`[Grid] Screener stored ${candidates.length} candidates.`);
    } catch (err: any) {
      await supabase
        .from('grid_engine')
        .update({ scan_requested: false, last_scan_error: err?.message || String(err) })
        .eq('id', 1);
      console.error(`[Grid] Screener failed: ${err?.message || err}`);
    }
  }
}

function resolveAccount(
  setting: SettingsRow,
  accounts: AccountRow[],
  primaryId: string | null
): { account: AccountRow } | { error: string } {
  const usable = accounts.filter(
    (account) =>
      (account.exchange === 'okx' || account.exchange === 'bybit') &&
      account.is_active &&
      account.is_validated &&
      !account.can_withdraw
  );
  const preferred = setting.exchange
    ? usable.find((account) => account.exchange === setting.exchange)
    : usable.find((account) => account.id === primaryId);
  if (!preferred) {
    return { error: setting.exchange ? `${setting.exchange} is not connected` : 'Trading exchange is not OKX or Bybit' };
  }
  return { account: preferred };
}
