# СПЕЦИФИКАЦИЯ ТОРГОВОГО ЯДРА (RAILWAY WORKER ENGINE)
## Проект: Bee Crypto Worker

---

## 1. Назначение и Архитектура Движка

Торговое ядро (**Worker Engine**) — это автономный сервис (Daemon), развернутый на платформе **Railway** со **статическим исходящим IP-адресом (Static Egress IP)**. 

Движок работает непрерывно 24/7 и решает 5 критические задачи:
1. **Мастер-анализ рынка (Market Scanner)**: непрерывный расчет EMA 10 по **динамической** корзине из `strategy_pairs` (через `PairRegistry`) плюс пары с открытыми `bot_positions` (union), чтобы trend-flip работал после ротации.
2. **Диспетчер сигналов (Master-Follower Dispatcher)**: при появлении сигнала на вход или выход — мгновенное зеркалирование ордеров на биржевых аккаунтах всех активных пользователей с масштабированием объемов под депозит каждого. Новые входы — только по активной глобальной корзине.
3. **Мониторинг позиций и риска (Position Risk Guard)**: отслеживание плавающего PnL связок в режиме реального времени, исполнение тейк-профитов (+5.0%), стоп-лоссов (-1.5%) и аварийных выходов.
4. **Динамический подбор пар (Pair Selection Job)**: ежедневный momentum-скринер + опциональная авторотация корзины (см. §8).
5. **Мониторинг здоровья (Health Ping)**: проверка доступности API бирж и отправка heartbeats в таблицу `system_health_logs` в Supabase.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        RAILWAY WORKER DAEMON                           │
│                                                                        │
│  ┌───────────────────────┐              ┌───────────────────────────┐  │
│  │   Market Listener     │              │     Supabase Sync &       │  │
│  │   (Binance WS 4h/1h)  │              │     Account Manager       │  │
│  └───────────┬───────────┘              └─────────────┬─────────────┘  │
│              │                                        │                │
│              ▼                                        ▼                │
│  ┌───────────────────────┐              ┌───────────────────────────┐  │
│  │ Strategy Calculation  │              │ Active Users Memory Cache │  │
│  │ (EMA 10 Ratio Check)  ├─────────────►│ (Decrypted Keys in RAM,   │  │
│  └───────────────────────┘    Signals   │  Balance, Margin Slots)   │  │
│                                         └─────────────┬─────────────┘  │
│                                                       │                │
│                                                       ▼                │
│                                         ┌───────────────────────────┐  │
│                                         │ Order Execution Pool      │  │
│                                         │ (CCXT: Binance/OKX/Bybit) │  │
│                                         └─────────────┬─────────────┘  │
│                                                       │                │
│                                                       ▼                │
│                                         ┌───────────────────────────┐  │
│                                         │ Reconciliation & Database │  │
│                                         │ (Write bot_positions)     │  │
│                                         └───────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Безопасность и Шифрование API-ключей (AES-256-GCM)

API-ключи пользователей хранятся в базе данных Supabase **исключительно в зашифрованном виде**. Расшифровка происходит **только в оперативной памяти воркера** непосредственно перед обращением к бирже.

### 2.1. Модуль шифрования (`src/security/encryption.ts`)
```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// ENCRYPTION_MASTER_KEY передается через Railway Environment Variables (32 байта Hex)
const MASTER_KEY = Buffer.from(process.env.ENCRYPTION_MASTER_KEY!, 'hex');

export interface EncryptedData {
  encrypted: string;
  iv: string;
  tag: string;
}

export function encryptString(plainText: string): EncryptedData {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
  
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag
  };
}

export function decryptString(encryptedHex: string, ivHex: string, tagHex: string): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    MASTER_KEY,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

---

## 3. Модуль интеграции с биржами (CCXT Factory)

Для каждой поддерживаемой биржи настраивается единый интерфейс через `ccxt.pro`:

### 3.1. Подключение аккаунта (`src/exchanges/exchange-factory.ts`)
```typescript
import ccxt from 'ccxt';
import { decryptString } from '../security/encryption.js';

export function createExchangeInstance(account: {
  exchange: 'binance' | 'okx' | 'bybit';
  encrypted_api_key: string;
  encrypted_secret: string;
  encrypted_passphrase?: string;
  iv_nonce: string;
  tag: string;
}) {
  const apiKey = decryptString(account.encrypted_api_key, account.iv_nonce, account.tag);
  const secret = decryptString(account.encrypted_secret, account.iv_nonce, account.tag);
  const password = account.encrypted_passphrase 
    ? decryptString(account.encrypted_passphrase, account.iv_nonce, account.tag)
    : undefined;

  const options: Record<string, any> = {
    apiKey,
    secret,
    password,
    enableRateLimit: true,
    options: {
      defaultType: 'future', // Торговля USDT фьючерсами
      adjustForTimeDifference: true,
    }
  };

  switch (account.exchange) {
    case 'binance':
      return new ccxt.pro.binanceusdm(options);
    case 'okx':
      return new ccxt.pro.okx(options);
    case 'bybit':
      return new ccxt.pro.bybit(options);
    default:
      throw new Error(`Unsupported exchange: ${account.exchange}`);
  }
}
```

### 3.2. Унификация торговых пар
Каждая биржа имеет свои суффиксы для бессрочных фьючерсов:
* **Binance**: `ZEC/USDT`
* **OKX**: `ZEC/USDT:USDT` (или SWAP)
* **Bybit**: `ZEC/USDT:USDT`

Фабрика бирж содержит маппинг символов для исключения ошибок неверного тикера.

---

## 4. Логика торговых сигналов и цикл исполнения

### 4.1. Главный аналитический цикл (`src/engine/market-scanner.ts`)
1. Движок опрашивает 4 пары каждые 10 секунд (через WebSocket тикеры):
   * `ZEC/AVAX`, `ENA/SUI`, `SOL/ADA`, `BNB/ETH`.
2. Каждые 4 часа (и на закрытии 1h свечи) пересчитывается значение $\text{EMA}_{10}$ отношения:
   $$\text{EMA}_{10}(t) = \alpha \cdot \text{Ratio}(t) + (1 - \alpha) \cdot \text{EMA}_{10}(t-1), \quad \alpha = \frac{2}{10 + 1} = 0.1818$$
3. Значения записываются в таблицу `pair_market_data` Supabase для отображения на фронтенде:
   * `current_ratio`
   * `ema_10`
   * `is_in_trend` (`true` если `current_ratio > ema_10`).

### 4.2. Исполнение входа в сделку (Entry Dispatcher)
Когда `is_in_trend` становится `true`, а у пользователя слот свободен:
1. Проверяется статус подписки: `subscription_status IN ('trial', 'active')` и `is_frozen = false`.
2. Запрашивается баланс пользователя: `fetchBalance()`.
3. Рассчитывается маржинальный слот (25% свободного баланса USDT).
4. Рассчитывается объем ног с плечом 7x:
   $$\text{Volume}_{\text{leg}} = \frac{\text{SlotMargin} \times 7}{2}$$
   $$\text{Qty}_{\text{Long}} = \frac{\text{Volume}_{\text{leg}}}{\text{Price}_{\text{Long}}}, \quad \text{Qty}_{\text{Short}} = \frac{\text{Volume}_{\text{leg}}}{\text{Price}_{\text{Short}}}$$
5. **Синхронный запуск двух ордеров**:
   * `createMarketBuyOrder(LongSymbol, QtyLong)`
   * `createMarketSellOrder(ShortSymbol, QtyShort)`
6. Запись в таблицу `bot_positions` со статусом `open`.

### 4.3. Сопровождение и выход (Exit Dispatcher)
Каждые 5 секунд воркер рассчитывает плавающий PnL связки:
$$\text{NetPnL}_{\%} = \frac{\text{PnL}_{\text{Long}} + \text{PnL}_{\text{Short}}}{\text{Volume}_{\text{leg}}}$$

* **Сценарий 1: Тейк-профит (+5.0%)**:
  * Если $\text{NetPnL}_{\%} \ge +0.05$:
  * Отправляются два ордера: `Market Sell` (закрытие лонга) и `Market Buy` (закрытие шорта).
  * Статус позиции в БД обновляется на `closed`, `exit_reason = 'tp'`.
* **Сценарий 2: Стоп-лосс (-1.5%)**:
  * Если $\text{NetPnL}_{\%} \le -0.015$:
  * Мгновенное закрытие обеих ног.
  * Статус позиции обновляется на `closed`, `exit_reason = 'sl'`.
* **Сценарий 3: Смена тренда (Trend Flip)**:
  * Если 4-часовая свеча соотношения закрылась ниже $\text{EMA}_{10}$:
  * Позиции закрываются по рынку, `exit_reason = 'trend_flip'`.
* **Сценарий 4: Экстренная кнопка пользователя (Panic Close)**:
  * Если пользователь нажал кнопку в кабинете, в базе выставляется флаг: воркер перехватывает сигнал за <1 секунды и закрывает связки.

---

## 5. Мониторинг здоровья и Heartbeat-система

Каждые 30 секунд воркер делает замер латентности и доступности компонентов:
* Запрос `ping` к Binance USD-M WebSocket.
* Запрос `ping` к OKX WebSocket.
* Запрос `ping` к Bybit WebSocket.
* Запись статуса (`healthy`, `degraded`, `down`) и `latency_ms` в таблицу `system_health_logs`.

Если биржа не отвечает более 3 циклов подряд — пользователям на фронтенд пушится уведомление через Supabase Realtime: *"Временная задержка связи с биржей Binance, позиции под контролем защитных стопов"*.

---

## 6. Структура проекта торгового воркера

```
bee_crypto_worker_engine/
├── package.json
├── tsconfig.json
├── Dockerfile                  # Для деплоя на Railway
├── src/
│   ├── index.ts                # Точка входа, запуск daemon
│   ├── config.ts               # Загрузка env, Supabase client
│   ├── api/
│   │   └── internal-server.ts  # HTTP: validate/sync via static egress (for Next.js)
│   ├── security/
│   │   └── encryption.ts       # AES-256-GCM шифрование/дешифрование
│   ├── exchanges/
│   │   ├── exchange-factory.ts # Фабрика CCXT для 3 бирж
│   │   ├── validator.ts        # Валидатор ключей (проверка прав и withdraw)
│   │   ├── symbols.ts          # DEFAULT_STRATEGY_PAIRS + маппинг тикеров
│   │   └── pair-registry.ts    # Кэш активной корзины из strategy_pairs
│   ├── engine/
│   │   ├── market-scanner.ts   # Ratio/EMA10: union(корзина ∪ open positions)
│   │   ├── position-guard.ts   # Мониторинг TP (+5%), SL (-1.5%)
│   │   └── order-router.ts     # Входы только по PairRegistry.isActivePair
│   ├── jobs/
│   │   ├── health-check.ts     # Пинг бирж каждые 30 сек
│   │   ├── billing-cron.ts     # Расчет недельного PnL и генерация инвойсов
│   │   └── pair-selection.ts   # Momentum-скринер + авторотация
│   └── types/
│       └── index.ts            # TypeScript интерфейсы
```

---

## 7. Execution & Risk Configuration (added 2026-09-04)

All new execution and risk parameters are configurable via environment variables in `worker/src/config.ts`. Defaults preserve the original behavior unless noted otherwise.

| Environment Variable | Default | Valid values / unit | Meaning |
|---|---|---|---|
| `TAKER_FEE_PCT` | `0.055` | Percent (e.g. `0.055` = 0.055%) | Taker fee rate used for fee estimation when the exchange does not return a fee or the fee currency is unknown. |
| `MAKER_FEE_PCT` | `0.02` | Percent (e.g. `0.02` = 0.02%) | Maker fee rate used for fee estimation when maker-hedge orders are filled as makers. |
| `ENTRY_EXECUTION_MODE` | `market` | `market` or `maker_hedge` | Entry execution mode. `market` sends immediate market orders. `maker_hedge` places post-only limit orders at best bid/ask, reprices up to `MAKER_MAX_REPRICES` times, and hedges any unfilled remainder with a market order as soon as one leg fills. |
| `EXIT_EXECUTION_MODE` | `market` | `market` or `maker_hedge` | Closing mode for `tp` and `trend_flip` exits. `panic_close` and `sl` exits always use market orders. |
| `MAKER_POLL_MS` | `1500` | Milliseconds | Polling interval for open maker-hedge limit orders. |
| `MAKER_MAX_REPRICES` | `5` | Count | Maximum number of reprice cycles for maker-hedge orders when the best price moves away by more than one tick. |
| `MAKER_TIMEOUT_MS` | `45000` | Milliseconds | Maximum time to wait for maker-hedge orders to fill before cancelling unfilled legs and hedging any partial fill. |
| `REENTRY_GUARD_ENABLED` | `true` | Boolean (`true`/`false`) | Master switch for the re-entry guard. When `false`, all re-entry checks are skipped. |
| `REENTRY_COOLDOWN_AFTER_SL_MS` | `14400000` (4h) | Milliseconds | Cooldown period after a stop-loss exit before a new position may be opened for the same key (user+pair or master+pair). |
| `REENTRY_REQUIRE_NEW_4H_CLOSE` | `true` | Boolean | After a stop-loss, require that at least one 4-hour candle has closed since the SL exit timestamp. |
| `REENTRY_HYSTERESIS_PCT` | `0.5` | Percent | After a stop-loss, require `currentRatio > lastExitRatio * (1 + pct/100)` before re-entering. |
| `MAX_CONSECUTIVE_SL` | `2` | Count | Consecutive stop-loss exit threshold. If the last N closed positions are all SLs and the latest is within the block window, entry is blocked. |
| `SL_STREAK_BLOCK_MS` | `86400000` (24h) | Milliseconds | Window during which a `MAX_CONSECUTIVE_SL` streak blocks new entries. |
| `RISK_MODE` | `margin` | `margin` or `spread` | How TP/SL thresholds are interpreted. `margin` triggers on PnL% of allocated margin (legacy behavior). `spread` interprets the configured TP/SL as a percentage move of the ratio, converted to margin PnL% via effective leverage (`total_position_volume_usd / allocated_margin_usd`). |
| `SL_ATR_MULT` | `1.5` | Multiplier (0 = disabled) | Optional ATR-based stop loss. When > 0, the SL threshold in spread terms is `SL_ATR_MULT * ATR14%`. The ATR is computed from the synthetic 4h ratio series using close-to-close log true range and Wilder's smoothing. The resulting margin threshold is capped by `SL_MAX_MARGIN_PCT`. |
| `SL_MAX_MARGIN_PCT` | `10` | Percent | Maximum margin PnL% for the SL threshold when using `spread` mode or ATR-based stops. |
| `TP_DISABLED` | `true` | Boolean | When `true`, the fixed take-profit is disabled; exits are triggered only by SL, trend flip or panic close. |
| `ENTRY_ON_4H_CLOSE_ONLY` | `true` | Boolean | When `true`, entry signals are evaluated only once per new closed 4-hour candle and use the closed candle's ratio against EMA10 (matching the validated backtest). When `false`, live-tick entries are allowed whenever `currentRatio > EMA10`. |
| `ENTRY_4H_CLOSE_GRACE_MS` | `600000` (10 min) | Milliseconds | Cold-start grace window for `ENTRY_ON_4H_CLOSE_ONLY`. On initial EMA load, if the last closed 4h candle is older than this grace window, it is seeded as already emitted so a redeploy does not open positions mid-candle. Candles within the grace window remain eligible as new signals. |
| `RISK_ON_NET_PNL` | `false` | Boolean | When `false` (default), TP/SL/ATR exit triggers use gross PnL% to match the validated backtest barriers. Dashboard `unrealized_pnl_usd`/`pnl_pct` are always stored net of known fees and funding. When `true`, triggers are also tested against net PnL%. |

When `ENTRY_ON_4H_CLOSE_ONLY=true`, the scanner refreshes the closed 4h EMA/ATR every 15 seconds (instead of 60 seconds) so entries fire shortly after the 4h close. This consumes one `fetchOHLCV` request per pair per refresh (4 pairs → ~16 requests per minute) and should be enabled only when the backtest-aligned entry behavior is required. The re-entry guard continues to work unchanged; `REENTRY_REQUIRE_NEW_4H_CLOSE` is naturally satisfied because each entry is already gated by a new closed candle.

---

## 8. Dynamic Pair Selection (added 2026-09-07)

### 8.1. PairRegistry
- Source of truth: `strategy_pairs` where `is_active = true`.
- In-memory cache refreshed every 60s; on empty table / DB error → fallback to `DEFAULT_STRATEGY_PAIRS` + warning log.
- OrderRouter allows entries only when `pairRegistry.isActivePair(pairSymbol)`.

### 8.2. Momentum screener algorithm (`PairSelectionJob`)
1. Universe: top `UNIVERSE_SIZE` (default 60) Binance USDT-M perps by 24h quote volume; exclude stables; require listing on Binance/OKX/Bybit; require ≥540 closed 4h bars.
2. For each ordered pair (A long, B short): drift t-stat of ratio log-returns (>2.0), positive drift in both 45d halves, leg correlation ≥0.5, `|β_A − β_B|` vs BTC ≤0.15, 24h volume ≥ `MIN_LEG_VOLUME_USD`, funding cost ≤0.05%/8h, last closed Ratio > EMA10.
3. Score = t-stat − funding penalty; greedy top-4 with each coin used at most once.
4. Guardrails before apply: hysteresis `ROTATION_HYSTERESIS` (1.25), max `ROTATION_MAX_REPLACEMENTS` (2), and `engine_settings.auto_rotation_enabled`. When disabled, candidates are saved on the run row but the basket is not changed.
5. Apply writes deactivate old rows, insert new active rows, and insert `audit_logs.action = pair_rotation_applied`. Open positions on removed pairs are **not** force-closed.

### 8.3. Scheduling
- Job ticks every 60s.
- Priority: process `pair_selection_runs` with `status=pending` (admin trigger).
- Else create a cron run after UTC `PAIR_SELECTION_UTC_HOUR`:`PAIR_SELECTION_UTC_MINUTE` (default 00:10) if none exists for the UTC day.
- Failures set run `status=failed` and never crash the daemon.

### 8.4. Pair selection env vars

| Environment Variable | Default | Meaning |
|---|---|---|
| `PAIR_SELECTION_ENABLED` | `true` | Master switch for the job loop. |
| `PAIR_SELECTION_UTC_HOUR` | `0` | UTC hour after which a daily cron run may start. |
| `PAIR_SELECTION_UTC_MINUTE` | `10` | UTC minute companion to the hour (default 00:10). |
| `ROTATION_MAX_REPLACEMENTS` | `2` | Max pairs swapped in one apply. |
| `ROTATION_HYSTERESIS` | `1.5` | Challenger score must be ≥ this × incumbent score. |
| `UNIVERSE_SIZE` | `60` | Top-N USDT-M perps by 24h volume. |
| `MIN_LEG_VOLUME_USD` | `100000000` | Min 24h quote volume per leg. |

> **Validation gate (2026-09-07):** walk-forward in `research/pair_selection/MOMENTUM_VALIDATION_RESULTS.md` failed (dynamic worse than static). Keep `engine_settings.auto_rotation_enabled = false` in production until the screener improves. Manual admin runs still store candidates for inspection.

### 8.5. Internal HTTP API (Next.js → worker proxy)

Vercel serverless egress IPs are blocked by Binance (`sapi`) and Bybit (CloudFront). Exchange validate/sync must run on the worker static egress IP.

| Environment Variable | Default | Meaning |
|---|---|---|
| `INTERNAL_API_ENABLED` | `true` | Start the HTTP API alongside the trading daemon. |
| `PORT` / `INTERNAL_API_PORT` | `8080` | Listen port (`PORT` preferred on Railway/DO). |
| `INTERNAL_API_SECRET` | _(empty)_ | Bearer secret; must match `WORKER_INTERNAL_SECRET` on the web app. |

Web env: `WORKER_INTERNAL_URL` (public HTTPS base of the worker) + `WORKER_INTERNAL_SECRET`.

Endpoints (auth required except `/health`):
- `GET /health`
- `POST /internal/exchange/validate` — live key check + futures balance
- `POST /internal/exchange/fetch-balance` — balance sync for encrypted credentials
