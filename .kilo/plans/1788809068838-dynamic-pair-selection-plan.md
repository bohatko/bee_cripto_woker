# План: Динамический подбор торговых пар (Momentum-скринер + авторотация)

## Цель
Заменить захардкоженную корзину из 4 пар (`worker/src/exchanges/symbols.ts:9-14`) на динамическую: ежедневный job (и кнопка в админке) сканирует топ USDT-M перпов, отбирает 4 лучшие momentum-пары и автоматически ротирует корзину с предохранителями.

## Принятые решения
1. **Метрики отбора — momentum, НЕ коинтеграция.** Research (`research/pair_selection/RESULTS.md`) доказал: mean-reversion скринер дает -34.8% OOS. Живой движок — momentum (Ratio > EMA10), отбираем пары с устойчивым дрейфом отношения.
2. **Полная авторотация** (выбор владельца) с guardrails: гистерезис, лимит замен, глобальный тумблер, аудит.
3. **Отбор — детерминированный TypeScript job внутри воркера** (не LLM): воспроизводимость, бесплатность, работает на Railway.
4. **Открытые позиции по убранным парам НЕ закрываются** — сопровождаются до TP/SL/Trend-Flip (аналогично политике is_frozen). Новые входы — только по актуальной корзине.
5. **Per-user `trading_settings.active_pairs` деперекатируется как whitelist**: при ротации массивы устаревают. OrderRouter переходит на глобальную корзину; `active_pairs = NULL` трактуется как «все пары корзины» (существующее значение колонки не удалять — обратная совместимость UI).
6. **Межбиржевой арбитраж — вне скоупа этой итерации** (зафиксировано с владельцем: доходность ~$150-400/мес на $10k его не устроила, остаемся на momentum-движке).
7. БД-миграции применять через Supabase MCP (доступен; проект `uxsbjkymrqrmlcshizns`).

## Алгоритм скринера (спецификация)

### Универсум
- Топ-60 USDT-M перпетуалов Binance по 24h quote volume (`ccxt.binanceusdm.fetchTickers` + `loadMarkets`).
- Исключить: стейблы (USDC, FDUSD, DAI...), leveraged-токены, BTC и ETH как ноги запрещать НЕ нужно (BNB/ETH уже в текущей корзине), монеты без полной истории 540 4h-баров.
- Монета обязана торговаться на всех 3 поддерживаемых биржах (binanceusdm, okx, bybit) — проверка через `getExchangeSymbol()`/`loadMarkets`, иначе часть пользователей не сможет открыть позицию.

### Данные
- 90 дней 4h OHLCV на монету: `fetchOHLCV(symbol, '4h', since, limit=500)` × 2 страницы = 540 баров. ~60 монет ≈ 120 запросов c rateLimit — приемлемо.
- BTC 4h — для расчета бет.
- Текущие funding rates обеих ног (`fetchFundingRate`).

### Формирование кандидатов
Для каждой упорядоченной пары (A=long, B=short), A ≠ B:
1. `ratio_t = P_A / P_B`, лог-доходности ratio по 4h.
2. **Drift t-stat** = mean(log-ret) / (std(log-ret) / sqrt(N)) за 90d — основной скор. Требование: > 2.0.
3. **Стабильность**: дрейф положителен в обеих половинах окна (45d/45d).
4. **Корреляция ног** (4h log-returns) ≥ 0.5 — снижает вол-ность спреда.
5. **Beta-нейтральность**: |beta_A − beta_B| vs BTC ≤ 0.15 (урок BNB/ETH: net beta −0.472 недопустим).
6. **Ликвидность**: 24h volume каждой ноги ≥ $50M (константа в конфиге).
7. **Funding-штраф**: ожидаемая стоимость funding позиции (платим лонг-фандинг A, получаем B) вычитается из скора; если стоимость > 0.05%/8h — пара отбрасывается.
8. **В тренде сейчас**: последний закрытый 4h Ratio > EMA10 (иначе пара «мертвая» для движка на входе).
9. Финальный скор = drift t-stat − funding-штраф (веса — константы).

### Сборка корзины
- Жадный отбор топ-4 по скору с ограничением: монета не встречается более чем в одной паре (ни как long, ни как short).
- Если валидных кандидатов < 4 — оставить текущие пары на свободных слотах (не заполнять мусором).

### Guardrails авторотации
- **Гистерезис**: действующая пара заменяется только если скор новой ≥ 1.25 × скор действующей (пересчитанный в этом же прогоне).
- **Лимит замен**: ≤ 2 пары за один прогон (env `ROTATION_MAX_REPLACEMENTS`, default 2).
- **Тумблер**: `engine_settings.auto_rotation_enabled` (default `true`), переключается в админке; при `false` прогон только сохраняет кандидатов, не применяет.
- Каждое применение — запись в `audit_logs` (action `pair_rotation_applied`, детали в jsonb).

## Изменения БД (миграция через Supabase MCP)

```sql
-- 1. Глобальная актуальная корзина
CREATE TABLE strategy_pairs (
  id UUID PK DEFAULT gen_random_uuid(),
  pair_symbol TEXT NOT NULL,          -- 'ZEC/AVAX'
  long_coin TEXT NOT NULL,
  short_coin TEXT NOT NULL,
  score NUMERIC, metrics JSONB,       -- t-stat, corr, beta, funding и пр.
  activated_at TIMESTAMPTZ DEFAULT now(),
  run_id UUID REFERENCES pair_selection_runs(id),
  is_active BOOLEAN DEFAULT true
);
-- Seed: 4 текущие пары (is_active=true, run_id NULL)

-- 2. Прогоны скринера (и триггер из админки)
CREATE TABLE pair_selection_runs (
  id UUID PK DEFAULT gen_random_uuid(),
  status TEXT CHECK (status IN ('pending','running','completed','failed')) DEFAULT 'pending',
  trigger_source TEXT CHECK (trigger_source IN ('cron','admin')),
  requested_by UUID NULL,             -- users_profile.user_id для admin-триггера
  started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
  universe_size INT, candidates JSONB, -- полный ранжированный список с метриками
  applied BOOLEAN DEFAULT false,
  replacements JSONB,                  -- что заменено на что
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Синглтон настроек движка
CREATE TABLE engine_settings (
  id INT PK DEFAULT 1 CHECK (id = 1),
  auto_rotation_enabled BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```
- RLS: чтение `strategy_pairs`/`pair_selection_runs` — все аутентифицированные (дашборд показывает корзину); INSERT в `pair_selection_runs` и UPDATE `engine_settings` — только `is_admin()`. Воркер — service role.
- Добавить `strategy_pairs`, `pair_selection_runs` в публикацию `supabase_realtime` (админка обновляется live).
- Обновить `doc/03_DATABASE_SCHEMA.sql` (тот же DDL).

## Изменения воркера

### `worker/src/exchanges/symbols.ts` — динамический реестр
- `STRATEGY_PAIRS` → `DEFAULT_STRATEGY_PAIRS` (fallback).
- Новый модуль `PairRegistry`: кэш активных пар из `strategy_pairs`, refresh каждые 60с; при пустой таблице/ошибке БД — fallback на дефолт + warning-лог.

### `worker/src/engine/market-scanner.ts`
- Сканировать **union(активная корзина, пары с открытыми `bot_positions`)** — критично: trend-flip exit обязан продолжать считаться по убранным парам, иначе открытые позиции останутся без сигнала выхода.
- `pair_market_data`: строки убранных пар помечать (`is_in_trend=false` недостаточно — добавить или переиспользовать поле для UI; минимально — просто перестать обновлять и удалять строку после закрытия последней позиции).

### `worker/src/engine/order-router.ts`
- Убрать проверку `.contains('active_pairs', ...)` (строка ~91); вход разрешен, если пара в активной глобальной корзине.

### Новый `worker/src/jobs/pair-selection.ts` (`PairSelectionJob`)
- `setInterval` 60с (паттерн как в `health-check.ts`):
  - подобрать `pending` прогон (admin-триггер) → выполнить;
  - иначе если UTC-время прошло `PAIR_SELECTION_UTC_HOUR` (default 00:10, сразу после закрытия 4h-свечи) и сегодня прогона не было → создать прогон `trigger_source='cron'` и выполнить.
- Пайплайн: universe → данные → кандидаты → корзина → guardrails → (apply: деактивация старых строк `strategy_pairs`, вставка новых, `audit_logs`) → запись результата в прогон.
- Все статусы/ошибки — в `pair_selection_runs`; job не должен ронять демон (try/catch, статус `failed`).
- Env: `PAIR_SELECTION_ENABLED` (default true), `PAIR_SELECTION_UTC_HOUR`, `ROTATION_MAX_REPLACEMENTS`, `ROTATION_HYSTERESIS` (1.25), `UNIVERSE_SIZE` (60), `MIN_LEG_VOLUME_USD` (50e6) — в `config.ts` + документировать в `doc/04`.
- Подключить в `index.ts` (start/stop как у других jobs).

## Изменения web (админка)

Новая секция на `web/src/app/admin/page.tsx` (или отдельный маршрут `admin/pairs`):
1. **Текущая корзина**: 4 пары, скор, метрики, дата активации.
2. **Кнопка "Run pair selection now"** → ConfirmModal → INSERT в `pair_selection_runs` (`trigger_source='admin'`) + `audit_logs`. Статус прогона live через Realtime.
3. **Тумблер Auto-rotation** (`engine_settings.auto_rotation_enabled`) → ConfirmModal.
4. **История прогонов**: таблица последних N с кандидатами (раскрывающийся jsonb) и заменами.
- UI-тексты на английском, палитра honey/emerald/rose, `font-mono` для чисел (правила репо).
- Дашборд пользователя: список пар уже читается из `pair_market_data` — работает без изменений; проверить, что нет других мест с хардкодом 4 пар (например, `(public)/page.tsx`).

## Порядок задач и назначение агентов (дешевые модели)

| # | Задача | Агент | Зависимости |
|---|---|---|---|
| 1 | SQL-миграция (3 таблицы, RLS, realtime, seed) + обновить `doc/03` | дешевый code-агент + Supabase MCP | — |
| 2 | `PairRegistry` + рефактор `symbols.ts`, scanner union-логика, order-router | дешевый code-агент | 1 |
| 3 | `jobs/pair-selection.ts` (скринер + ротация + guardrails), env в `config.ts`, wiring в `index.ts` | средний code-агент (самая сложная часть — математика скринера) | 1, 2 |
| 4 | Админка: секция пар, кнопка запуска, тумблер, история | дешевый code-агент | 1 |
| 5 | Валидация скринера на исторических данных: python-скрипт `research/pair_selection/momentum_screener_validation.py` — прогнать momentum-отбор walk-forward на существующих `research/data/4h_*.csv` (переиспользовать загрузчик `download_universe.py`), сравнить с baseline «статичные 4 пары» | дешевый агент | параллельно 2-4 |
| 6 | Обновить `doc/04_WORKER_ENGINE_SPECIFICATION.md`, `doc/05`, `AGENTS.md` (раздел 4: корзина теперь динамическая) | дешевый агент | 3, 4 |

## Проверка (validation)
1. `worker`: `npm run build` без ошибок; локальный запуск — job создает cron-прогон, пишет кандидатов.
2. Ручной триггер из админки → прогон `pending → running → completed`, Realtime-обновление статуса.
3. Ротация: подсунуть в БД пару с низким скором → прогон заменяет ≤ 2 пар, `audit_logs` содержит запись, гистерезис не дает заменить пару с близким скором.
4. Открытая позиция по убранной паре: scanner продолжает считать EMA/trend-flip, PositionGuard закрывает по сигналу.
5. Fallback: очистить `strategy_pairs` → воркер работает на `DEFAULT_STRATEGY_PAIRS`, warning в логах.
6. `web`: `npx tsc --noEmit` + `npm run build`.
7. Скрипт валидации (задача 5): momentum-отбор не хуже статичной корзины на 18-мес истории — гейт перед включением авторотации в проде.

## Риски
- **Главный**: research показал, что momentum-прибыль исторически концентрировалась в одной аномалии (ZEC +8108%). Скринер систематизирует поиск таких дрейфов, но гарантий нет — задача 5 (валидация) обязательна до включения авторотации на реальных деньгах; до этого держать `auto_rotation_enabled=false` в проде.
- Rate limits при загрузке 120+ OHLCV-запросов — использовать встроенный rateLimit CCXT, прогон может занимать 3-5 мин (это job, не критично).
- Новые монеты с малой историей (<540 баров) отфильтровываются автоматически.
- Defaults воркера все еще Scenario A (7x, TP+5%/SL−1.5%) — вне скоупа, но напомнить владельцу, что бэктест показал ликвидацию на этих параметрах.

## Вне скоупа
- Межбиржевой арбитраж (одна монета на двух биржах) и funding-harvesting.
- Изменение параметров риска движка (leverage/TP/SL) и переход на Scenario C defaults.
- Per-user кастомизация корзины.
