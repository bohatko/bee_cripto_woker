# СПЕЦИФИКАЦИЯ ТОРГОВОГО ЯДРА (RAILWAY WORKER ENGINE)
## Проект: Bee Crypto Worker

---

## 1. Назначение и Архитектура Движка

Торговое ядро (**Worker Engine**) — это автономный сервис (Daemon), развернутый на платформе **Railway** со **статическим исходящим IP-адресом (Static Egress IP)**. 

Движок работает непрерывно 24/7 и решает 4 критические задачи:
1. **Мастер-анализ рынка (Market Scanner)**: непрерывный расчет индикаторов (EMA 10) по 4 структурным парам (`ZEC/AVAX`, `ENA/SUI`, `SOL/ADA`, `BNB/ETH`).
2. **Диспетчер сигналов (Master-Follower Dispatcher)**: при появлении сигнала на вход или выход — мгновенное зеркалирование ордеров на биржевых аккаунтах всех активных пользователей с масштабированием объемов под депозит каждого.
3. **Мониторинг позиций и риска (Position Risk Guard)**: отслеживание плавающего PnL связок в режиме реального времени, исполнение тейк-профитов (+5.0%), стоп-лоссов (-1.5%) и аварийных выходов.
4. **Мониторинг здоровья (Health Ping)**: проверка доступности API бирж и отправка heartbeats в таблицу `system_health_logs` в Supabase.

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
│   ├── security/
│   │   └── encryption.ts       # AES-256-GCM шифрование/дешифрование
│   ├── exchanges/
│   │   ├── exchange-factory.ts # Фабрика CCXT для 3 бирж
│   │   ├── validator.ts        # Валидатор ключей (проверка прав и withdraw)
│   │   └── symbols.ts          # Маппинг тикеров бирж
│   ├── engine/
│   │   ├── market-scanner.ts   # Расчет Ratio и EMA10 по 4 парам
│   │   ├── position-guard.ts   # Мониторинг TP (+5%), SL (-1.5%)
│   │   └── order-router.ts     # Выставление и закрытие ордеров
│   ├── jobs/
│   │   ├── health-check.ts     # Пинг бирж каждые 30 сек
│   │   └── billing-cron.ts     # Расчет недельного PnL и генерация инвойсов
│   └── types/
│       └── index.ts            # TypeScript интерфейсы
```
