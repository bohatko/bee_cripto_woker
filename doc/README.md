# ИНДЕКС ДОКУМЕНТАЦИИ ПРОЕКТА
## Bee Crypto Worker — SaaS Платформа Рыночно-Нейтрального Алготрейдинга
супа на bohatkovictor+1@gmail.com
Вся архитектурная, алгоритмическая, математическая и техническая база проекта зафиксирована в папке `doc/` в виде исчерпывающих руководств:

```
C:\Projects\PET-projects\bee_cripto_woker\doc\
├── 01_TECHNICAL_SPECIFICATION.md          # Полное ТЗ продукта, архитектура, SaaS-модель, требования
├── 02_STRATEGY_AND_BACKTESTS.md           # Математика стратегии, состав корзины, тесты за 6 месяцев
├── 03_DATABASE_SCHEMA.sql                 # Готовый SQL-скрипт схемы БД Supabase (таблицы, RLS, Realtime)
├── 04_WORKER_ENGINE_SPECIFICATION.md      # Спецификация торгового ядра на Railway, CCXT, шифрование AES-256
├── 05_FRONTEND_AND_UI_SPECIFICATION.md    # Спецификация UI/UX Next.js 15, экраны, дашборд, модалки
├── 06_IMPLEMENTATION_ROADMAP_AND_AGENTS_GUIDE.md # Пошаговый план разработки из 6 этапов для агентов
└── README.md                              # Данный индексный файл
```

---

### Краткое описание документов:

1. **`01_TECHNICAL_SPECIFICATION.md`**:
   * Описание SaaS-платформы, монетизация: 7 дней бесплатного триала, далее $20/неделю + 10% от чистой прибыли по принципу High-Water Mark (HWM).
   * Полуручной прием платежей по QR-коду / кошельку биржи.
   * Безопасное поведение при просрочке инвойса (Вариант А — заморозка только новых сделок, доведение открытых до тейка).
   * Поддержка 3 ведущих бирж: Binance, OKX, Bybit.

2. **`02_STRATEGY_AND_BACKTESTS.md`**:
   * Теория парного трейдинга и состав корзины из 4 пар.
   * **Честный 1m-бэктест** (март–сентябрь 2026): Scenario A (live) = ликвидация $-100%$; Scenario C (paper) = +48,6% / +116,7% taker/maker in-sample с оговорками по робастности.
   * Отзыв синтетических цифр ($1,37M / 8,7% DD) — см. `research/backtest/RESULTS.md`.
   * Рекомендуемая конфигурация для paper-trading — раздел 6.

**Research (количественные исследования):**

| Путь | Содержание |
| :--- | :--- |
| [`research/README.md`](../research/README.md) | Индекс исследований, установка, запуск скриптов |
| [`research/backtest/RESULTS.md`](../research/backtest/RESULTS.md) | Честный 1m-бэктест, Scenario A/C, grid, робастность |
| [`research/cointegration/RESULTS.md`](../research/cointegration/RESULTS.md) | Коинтеграция, Hurst, EMA10 predictive power, beta |

3. **`03_DATABASE_SCHEMA.sql`**:
   * Полный рабочий SQL-код для консоли Supabase.
   * 8 оптимизированных таблиц: `users_profile`, `exchange_accounts`, `trading_settings`, `pair_market_data`, `bot_positions`, `invoices`, `system_health_logs`, `audit_logs`.
   * Настроенные политики безопасности Row-Level Security (RLS) для изоляции пользователей.
   * Автоматические триггеры создания профиля при регистрации и публикации в `supabase_realtime`.

4. **`04_WORKER_ENGINE_SPECIFICATION.md`**:
   * Архитектура круглосуточного сервиса на Railway со статическим исходящим IP (Static Egress IP) для белых списков на биржах.
   * Код модуля шифрования AES-256-GCM для защиты API-ключей.
   * Фабрика CCXT для Binance, OKX, Bybit.
   * Алгоритм сканирования EMA 10, распределения объемов и сопровождения TP (+5.0%) / SL (-1.5%).
   * Heartbeat-мониторинг бирж.

5. **`05_FRONTEND_AND_UI_SPECIFICATION.md`**:
   * Структура маршрутов Next.js 15 App Router.
   * Неоновый финтех-дизайн в стиле Raydium / Linear на базе Tailwind и shadcn/ui.
   * Спецификация публичного лендинга с калькулятором доходности.
   * Дашборд с монитором здоровья системы, балансом и прогресс-барами парных позиций.
   * Обязательные модальные окна подтверждения для всех действий (старт, пауза, удаление ключей, экстренный Panic Close).
   * Экран оплаты инвойсов с генерацией QR-кода и админ-панель подтверждения платежей.

6. **`06_IMPLEMENTATION_ROADMAP_AND_AGENTS_GUIDE.md`**:
   * Пошаговая дорожная карта из 6 этапов: от развертывания Supabase до финального smoke-тестирования.
   * Конкретные команды, чек-листы и правила валидации для автономных ИИ-агентов и разработчиков.
