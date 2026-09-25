# ИНДЕКС ДОКУМЕНТАЦИИ ПРОЕКТА
## Crypto B (Bee Crypto Worker) — SaaS Платформа Рыночно-Нейтрального Алготрейдинга

Вся архитектурная, алгоритмическая, математическая и техническая база проекта зафиксирована в папке `doc/` в виде исчерпывающих руководств:

```
doc/
├── 01_TECHNICAL_SPECIFICATION.md          # Полное ТЗ продукта, архитектура, SaaS-модель, требования
├── 02_STRATEGY_AND_BACKTESTS.md           # Математика стратегии, состав корзины, честные бэктесты
├── 03_DATABASE_SCHEMA.sql                 # SQL-схема БД Supabase (15 таблиц, RLS, Realtime)
├── 04_WORKER_ENGINE_SPECIFICATION.md      # Спецификация торгового ядра (Railway, CCXT, AES-256-GCM)
├── 05_FRONTEND_AND_UI_SPECIFICATION.md    # Спецификация UI/UX Next.js 15, экраны, дашборд, модалки
├── 06_IMPLEMENTATION_ROADMAP_AND_AGENTS_GUIDE.md  # Исторический план сборки проекта (архив)
├── 07_SIGNALS_DIP_BUY_XRP.md              # Спецификация сигнального движка Dip-Buy (XRP / ETH / BTC)
├── migrations/                            # Применённые SQL-миграции по датам
└── README.md                              # Данный индексный файл
```

> **Статус документации (2026-09-15):** `doc/06` — исторический план сборки «с нуля»; проект реализован, и этот документ **не является источником истины** по текущим параметрам. Актуальные параметры движка — [`AGENTS.md`](../AGENTS.md) §4, [`doc/02`](02_STRATEGY_AND_BACKTESTS.md) разделы 4–6 и [`doc/04`](04_WORKER_ENGINE_SPECIFICATION.md).

---

### Краткое описание документов:

1. **`01_TECHNICAL_SPECIFICATION.md`**:
   * Описание SaaS-платформы, монетизация: 7 дней бесплатного триала, далее $20/неделю (фиксированная плата без комиссии с прибыли).
   * Полуручной прием платежей по QR-коду / кошельку биржи.
   * Безопасное поведение при просрочке инвойса (Вариант А — заморозка только новых сделок, доведение открытых до выхода).
   * Поддержка 3 ведущих бирж: Binance, OKX, Bybit.

2. **`02_STRATEGY_AND_BACKTESTS.md`**:
   * Теория парного трейдинга и состав корзины из 4 пар.
   * **Честный 1m-бэктест** (март–сентябрь 2026): Scenario A (live) = ликвидация $-100\%$; Scenario C (paper) = +48,6% / +116,7% taker/maker in-sample с оговорками по робастности.
   * Отзыв синтетических цифр ($1,37M / 8,7% DD) — см. `research/backtest/RESULTS.md` §Executive Summary.
   * Рекомендуемая конфигурация для paper-trading — раздел 6.

**Research (количественные исследования):**

| Путь | Содержание |
| :--- | :--- |
| [`research/README.md`](../research/README.md) | Индекс исследований, установка, запуск скриптов |
| [`research/backtest/RESULTS.md`](../research/backtest/RESULTS.md) | Честный 1m-бэктест, Scenario A/C, grid, робастность |
| [`research/cointegration/RESULTS.md`](../research/cointegration/RESULTS.md) | Коинтеграция, Hurst, EMA10 predictive power, beta |
| [`research/pair_selection/RESULTS.md`](../research/pair_selection/RESULTS.md) | Систематический скринер пар, воронка, FDR, OOS MR бэктест |
| [`research/pair_selection/MOMENTUM_VALIDATION_RESULTS.md`](../research/pair_selection/MOMENTUM_VALIDATION_RESULTS.md) | Walk-forward momentum vs static basket (гейт авторотации) |
| [`research/pair_selection/ENGINE_AWARE_VALIDATION_RESULTS.md`](../research/pair_selection/ENGINE_AWARE_VALIDATION_RESULTS.md) | Engine-aware валидация скринера: текущий статус гейта (FAIL) |

> Данные для исследований (`research/data/`) и результаты прогонов (`research/*/out/`) — локальный кэш, не хранится в репозитории и пересоздаётся скриптами `download_data.py` / `backtest.py`.

3. **`03_DATABASE_SCHEMA.sql`**:
   * Полный рабочий SQL-код для консоли Supabase: **15 таблиц**.
   * Ядро: `users_profile`, `exchange_accounts`, `trading_settings`, `pair_market_data`, `bot_positions`, `invoices`, `system_health_logs`, `audit_logs`.
   * Динамическая корзина: `pair_selection_runs`, `strategy_pairs`, `engine_settings`.
   * Модуль сигналов: `signal_strategies`, `user_signal_settings`, `signal_events`, `signal_positions`.
   * Настроенные политики безопасности Row-Level Security (RLS) для изоляции пользователей.
   * Автоматические триггеры создания профиля при регистрации и публикации в `supabase_realtime`.
   * История изменений схемы — `doc/migrations/` (по датам применения).

4. **`04_WORKER_ENGINE_SPECIFICATION.md`**:
   * Архитектура круглосуточного сервиса на Railway со статическим исходящим IP (Static Egress IPs EU West HA: `208.77.244.240`, `152.55.185.189`, `152.55.185.190`) для белых списков на биржах.
   * Код модуля шифрования AES-256-GCM для защиты API-ключей.
   * Фабрика CCXT для Binance, OKX, Bybit.
   * Алгоритм сканирования EMA 10, `PairRegistry`, momentum/engine-aware pair-selection job.
   * Риск-модель: `TP_DISABLED=true`, ATR-стоп-лосс (`SL_ATR_MULT=1.5`, cap `SL_MAX_MARGIN_PCT=10`), trend-flip выход, `MAX_LEVERAGE=3`.
   * Heartbeat-мониторинг бирж.

5. **`05_FRONTEND_AND_UI_SPECIFICATION.md`**:
   * Структура маршрутов Next.js 15 App Router (актуальный список — §2).
   * Тёмная neo-fintech тема на базе Tailwind (Dark + Honey Amber `#F59E0B`).
   * Спецификация реализованного лендинга: интерактивная 3D-пчела на Three.js, живой риббон пар, калькулятор прибыли — §3.1.
   * Дашборд с монитором здоровья системы, балансом и прогресс-барами парных позиций.
   * Обязательные модальные окна подтверждения для всех действий (старт, пауза, удаление ключей, экстренный Panic Close).
   * Экран оплаты инвойсов; админ-панель: инвойсы + вкладка Pairs & Rotation.

6. **`06_IMPLEMENTATION_ROADMAP_AND_AGENTS_GUIDE.md`** (архив):
   * Историческая дорожная карта сборки проекта от развертывания Supabase до smoke-тестирования.
   * Конкретные команды, чек-листы и правила валидации. Часть цифр и путей устарела — см. предупреждение в самом документе.

7. **`07_SIGNALS_DIP_BUY_XRP.md`**:
   * Спецификация независимого сигнального ядра Dip-Buy для трёх монет: XRP (окно 24ч), ETH (окно 1ч), BTC (окно 7м).
   * Триггеры падения, изолированное плечо, биржевые reduce-only TP/SL, readiness-алерты в Telegram (80% / 90%).
   * Master paper-бенчмарк и репликация сделок пользователям.

8. **Подписка Lite / Pro** (миграция [`migrations/2026-09-25_subscription_plans.sql`](migrations/2026-09-25_subscription_plans.sql)):
   * Процент с прибыли снят. Партнёру начисляется $50 один раз, если приглашённый оплатил подписку не ниже Lite на месяц. Бонус доступен к выводу через месяц, заявка — от $100 USDT (`migrations/2026-09-25_referral_flat_bonus.sql`, `migrations/2026-09-25_referral_withdrawals.sql`). Миграция `2026-09-23_referral_program.sql` больше не действует.
   * Lite: 70 USDT/месяц или 700 USDT/год. Только Dip-Buy и одна биржа.
   * Pro: 200 USDT/месяц или 2000 USDT/год. Все модули, приоритетная поддержка и годовая страховка депозита (собственные снятия не считаются убытком).
   * У обоих тарифов триал 7 дней. Новые аккаунты начинают с Lite; уже существующие триал/активные профили оставлены на Pro, чтобы не оборвать текущие сделки.
