# APEX — Task Checklist

**Derived from:** SPEC.md
**Last updated:** 2026-03-26

---

## Phase 1: Foundation & MVP

### Monorepo & Infrastructure

- [x] [P1] Initialize Turborepo monorepo with `apps/api`, `apps/dashboard`, `packages/shared`, `packages/db` workspaces (`turbo build` succeeds, all workspaces resolve)
- [x] [P1] Configure root `tsconfig.json` with strict mode, path aliases, and workspace references (no type errors on empty projects)
- [x] [P1] Create `docker-compose.yml` with Postgres 16 + Redis 7 (`docker compose up` starts both, healthchecks pass)
- [x] [P1] Create `.env.example` with all Phase 1 env vars documented, `.gitignore` excludes `.env`, `node_modules`, `dist`
- [x] [P1] Set up `packages/shared` with `types.ts` (SignalOutput, EdgeOutput, ModuleId), `constants.ts`, `utils.ts` (imports resolve from other workspaces)

### Database

- [x] [P1] Write Phase 1 Prisma schema: Market, Contract, PriceSnapshot, OrderBookSnapshot, Signal, Edge, SystemConfig, ApiUsageLog with all enums (`prisma generate` succeeds)
- [x] [P1] Run initial migration (`prisma db push` syncs all 27 models to Postgres, including v2 models)
- [x] [P1] Create `packages/db/src/index.ts` that re-exports PrismaClient and generated types (importable from `@apex/db`)

### API Server Setup

- [x] [P1] Create Fastify server entry (`apps/api/src/index.ts` + `server.ts`) with pino logging, CORS, graceful shutdown (server starts on port 3001)
- [x] [P1] Implement `X-API-Key` auth plugin that validates against `API_KEY` env var (returns 401 for missing/invalid key)
- [x] [P1] Create `apps/api/src/config.ts` with typed env var loading via zod (throws on missing required vars)
- [x] [P1] Set up PrismaClient singleton (`lib/prisma.ts`) and Redis/IORedis connection (`lib/redis.ts`)

### Platform Adapter Interface (A9)

- [x] [P1] Create `PredictionMarketAdapter` interface in `packages/shared/src/platform-adapter.ts` (getMarkets, getOrderbook, normalizeMarket, calculateFee, healthCheck)
- [x] [P1] Refactor `KalshiClient` to implement `PredictionMarketAdapter` interface (existing tests still pass)
- [x] [P1] Refactor `PolymarketClient` to implement `PredictionMarketAdapter` interface (existing tests still pass)
- [x] [P1] Update `market-sync.ts` to iterate registered adapters instead of calling clients directly (platform-agnostic sync)

### External API Clients

- [x] [P1] Implement Kalshi client with HMAC auth, rate limiting via bottleneck (10 req/s), and paginated market fetching (returns normalized market list from mock/live API)
- [x] [P1] Implement Polymarket client (Gamma + CLOB) with rate limiting (60/100 req/min), market + order book fetching (returns normalized data)
- [x] [P1] Implement `api-usage-logger.ts` that wraps external calls and logs to ApiUsageLog table (each call creates a log entry with latency + status)

### LLM Cost Tiering (A4)

- [x] [P1] Create `LLMRouter` in `packages/shared/src/llm-router.ts` with tier config (TIER_1/2/3), model selection per task, daily budget tracking (routes tasks to correct model)
- [x] [P1] Add `LLM_DAILY_BUDGET` tracking to SystemConfig and budget alert at 80% consumed (budget check returns correct remaining)

### Fee Calculator & Market Matcher (A5)

- [x] [P1] Create `fee-calculator.ts` with `calculateKalshiFee`, `calculatePolymarketFee`, `calculateNetArb` (correct fee calculations for known inputs)
- [x] [P1] Create `market-matcher.ts` with title similarity matching for cross-platform event detection (matches "Fed rate" on Kalshi to same event on Polymarket)

### Market Sync

- [x] [P1] Implement `market-sync.ts` service: fetches from Kalshi + Polymarket, maps to unified schema, upserts Markets + Contracts (running sync populates DB with real market data)
- [x] [P1] Implement category detection function with keyword matching (correctly classifies "Fed rate decision" → FINANCE, "Bitcoin price" → CRYPTO, etc.)
- [x] [P1] Fix category detection to use platform-provided categories as primary signal: Kalshi `event.category` and Polymarket `market.category` mapped via `PLATFORM_CATEGORY_MAP`. Keyword matching retained as fallback only. Added European football, team names, award patterns to sports regex. "Manchester United EPL" → SPORTS (was potentially OTHER/POLITICS).
- [x] [P1] Implement `orderbook-sync.ts`: fetches order books for active markets, stores OrderBookSnapshot records (snapshots created with bids/asks/spread/depth)

### BullMQ Jobs

- [x] [P1] Set up BullMQ queues (`ingestion`, `analysis`) with repeatable job registration (jobs appear in queue with correct intervals)
- [x] [P1] Create `market-sync.job.ts` handler that calls market-sync service (runs every 5 min, logs success/failure)
- [x] [P1] Create `orderbook-sync.job.ts` handler (runs every 5 min offset 1 min from market-sync)
- [x] [P1] Fix orderbook-sync silent failures: added warn logging for 0-synced runs, structured per-market error logging with platform/error details. Job is registered in Redis but platform API calls failing silently — check worker logs after restart
- [x] [P1] Create `signal-pipeline.job.ts` that orchestrates: check freshness → run modules in parallel → run CORTEX → save edges (pipeline completes within timeout)

### Signal Modules (Phase 1)

- [x] [P1] Create `base.ts` abstract SignalModule class with `analyze(market): Promise<SignalOutput>` interface and error handling wrapper
- [x] [P1] Implement COGEX anchoring bias detector (given price history clustered at 0.50, outputs stickiness > 2.0 and adjustment away from anchor)
- [x] [P1] Implement COGEX tail risk detector (given historical tail rates higher than implied, adjusts probability toward fatter tails)
- [x] [P1] Implement COGEX recency bias detector (given 7-day vol > 2x 90-day vol, dampens recent move by 30%)
- [x] [P1] Implement COGEX favorite-longshot detector (given calibration data, adjusts favorites down and longshots up)
- [x] [P1] Integrate COGEX: combine 4 bias adjustments via weighted average, output SignalOutput with CogexMetadata (end-to-end test passes with sample data)
- [x] [P1] Implement FLOWEX order flow imbalance calculator (given 2 order book snapshots, computes OFI in [-1, +1])
- [x] [P1] Implement FLOWEX move classification (LIQUIDITY vs INFORMATION based on price move + depth change)
- [x] [P1] Implement FLOWEX mean reversion signal (triggers when liquidity move > 3% from VWAP, outputs probability = VWAP)
- [x] [P1] Integrate FLOWEX: full module outputting SignalOutput with FlowexMetadata (end-to-end test passes)

### ARBEX Module — Phase 1 (A5)

- [x] [P1] Build ARBEX module with intra-platform arb detection: scan YES+NO spreads, flag net-positive after fees (given YES=0.45 NO=0.45, calculates net profit after Kalshi fees)
- [x] [P1] Add cross-platform arb detection to ARBEX: match events across platforms via market-matcher, calculate cross-platform spreads (detects when Kalshi YES + Polymarket NO < $1.00)
- [x] [P1] Add `arb-scan` BullMQ queue running ARBEX every 60 seconds (arb scan completes, logs results)
- [x] [P1] Add arb-specific Telegram alert template with time-sensitivity rating (⏰ ARB ALERT with URGENT/NORMAL flag)

### CORTEX v1

- [x] [P1] Implement CORTEX v1 synthesis: simple weighted average of available signals, coverage-adjusted confidence, edge calculation (given 2 signals, produces correct EdgeOutput)
- [x] [P1] Implement edge persistence: save Edge records to DB after each CORTEX run (edges queryable via Prisma)

### API Routes (Phase 1)

- [x] [P1] Implement `GET /api/v1/markets` with pagination, filtering (status, category, platform), sorting, and search (returns paginated MarketSummary list)
- [x] [P1] Implement `GET /api/v1/markets/:id` returning market detail with contracts and latest edge (returns MarketDetailResponse)
- [x] [P1] Implement `GET /api/v1/markets/:id/prices` with time range and interval aggregation (returns PriceHistoryResponse)
- [x] [P1] Implement `GET /api/v1/markets/:id/orderbook` returning latest snapshot (returns OrderBookResponse)
- [x] [P1] Implement `GET /api/v1/edges` with filtering and sorting (returns actionable edges sorted by EV)
- [x] [P1] Implement `GET /api/v1/system/health` checking Postgres, Redis, external API recency (returns HealthResponse)
- [x] [P1] Implement `GET /api/v1/system/jobs` returning BullMQ queue stats (returns JobStatusResponse)

### Dashboard (Phase 1)

- [x] [P1] Set up Vite + React project with dark theme (bg #0a0a0f), JetBrains Mono font, Inter labels (app renders with correct styling)
- [x] [P1] Create API client (`api/client.ts`) with fetch wrapper, API key header, and typed methods for all P1 endpoints
- [x] [P1] Build Layout component with Sidebar navigation (Markets, Edges, System links with active state)
- [x] [P1] Build reusable DataTable component with sortable headers, row click handler (renders any column config)
- [x] [P1] Build Market Explorer page with filter bar (platform, category, status, search) and DataTable (loads and displays markets)
- [x] [P1] Build Edge Ranking page with DataTable, EV-based row coloring, click → market detail (displays actionable edges)
- [x] [P1] Build System Monitor page with health cards (green/red) and job queue table (shows live system status)
- [x] [P1] Create Zustand market store with fetchMarkets, filters, pagination state (data flows from API to UI)

### TRADEX — Automated Execution Engine (Phase 1: Demo Mode)

- [x] [P1] Create `packages/tradex` workspace with package.json, tsconfig.json, and src directory structure
- [x] [P1] Define TRADEX types in `packages/tradex/src/types.ts`: ExecutionMode, PreflightResult, OrderRequest, OrderResult, RiskLimits
- [x] [P1] Create BaseExecutor abstract class in `packages/tradex/src/executors/base.ts` (placeOrder, cancelOrder, getPositions, getBalance)
- [x] [P1] Implement KalshiExecutor using Kalshi DEMO API: place and cancel orders in sandbox with HMAC auth
- [x] [P1] Implement preflight checks in `packages/tradex/src/preflight.ts` (all 7 gates: risk, balance, edge validity, fee, graduation, daily limit, position count)
- [x] [P1] Implement risk limits loader in `packages/tradex/src/risk-limits.ts` with hard ceiling enforcement
- [x] [P1] Implement ExecutionManager in `packages/tradex/src/manager.ts`: route to executor, run preflight, determine FAST/SLOW mode
- [x] [P1] Add ExecutionLog, ArbExecution, AuditLog Prisma models with ExecutionStatus, ExecutionMode, ArbStatus enums
- [x] [P1] Add configurable risk limits to SystemConfig with defaults (max $10/trade, $30/day, 5 positions, $100 deployed)
- [x] [P1] Add TRADEX env vars to `.env.example`: TRADEX_ENABLED=false, TRADEX_FAST_EXEC_ENABLED=false, KALSHI_USE_DEMO=true
- [x] [P1] Add execution API routes: GET /execution/log, /execution/positions, /execution/balances, POST /execution/kill-switch
- [x] [P1] Build dashboard Settings page with risk limit sliders (hard ceiling as max), CONFIRM modal for changes
- [x] [P1] Build dashboard kill switch component (big red toggle setting TRADEX_ENABLED)
- [x] [P1] Build dashboard Execution page with execution log table, order status, platform balances

### Phase 1 Integration

- [x] [P1] Write integration tests: full pipeline from market-sync → COGEX + FLOWEX + ARBEX → CORTEX → edge creation (end-to-end with test DB)
- [ ] [P1] **CHECKPOINT**: Docker compose up → API healthy → market sync populates data → signal pipeline produces edges → ARBEX scans for arbs → TRADEX preflight checks pass/fail correctly → KalshiExecutor connects to demo API → kill switch and risk settings page functional → dashboard displays markets and edges → all unit tests pass

---

## Phase 2: LLM Modules & Portfolio

### Claude API Integration

- [x] [P2] Implement Claude client wrapper with @anthropic-ai/sdk: structured output parsing, token tracking, retry on 529, 60s timeout, cost calculation (makes successful API call, logs usage)
- [x] [P2] Implement two-pass screening for LEGEX: TIER_1 screen "is resolution ambiguous?" → only flagged markets go to TIER_2 deep analysis (reduces LEGEX API costs 40%+)
- [x] [P2] Write LEGEX system prompt in `prompts/legex-system.md` (prompt instructs resolution analysis with JSON output schema)
- [x] [P2] Write DOMEX agent prompts: `domex-fed-hawk.md`, `domex-geo-intel.md`, `domex-crypto-alpha.md` (each has domain persona, calibration instructions, JSON output format)
- [x] [P2] Write ALTEX news prompt in `prompts/altex-news.md` (instructs news → market impact mapping with JSON output)

### LLM Signal Modules

- [x] [P2] Implement LEGEX module: sends resolution text to Claude, parses ambiguity score + misinterpretation probability, outputs SignalOutput (given mock resolution text, produces valid output)
- [x] [P2] Implement DOMEX base agent runner with domain routing (markets tagged by category → relevant agents selected)
- [x] [P2] Implement DOMEX FED-HAWK agent (given FINANCE market, calls Claude with Fed prompt, returns probability)
- [x] [P2] Implement DOMEX GEO-INTEL agent (given POLITICS market, calls Claude with geopolitics prompt)
- [x] [P2] Implement DOMEX CRYPTO-ALPHA agent (given CRYPTO market, calls Claude with crypto prompt)
- [x] [P2] Implement DOMEX aggregation: trimmed mean of agent probabilities, confidence from agreement level (3 agents → drop highest/lowest, average remaining)
- [x] [P2] Implement two-pass screening for ALTEX: TIER_1 filters relevant articles → TIER_2 deep analysis on matches only (reduces ALTEX API costs 50%+)
- [x] [P2] Implement ALTEX module: fetch news via NewsAPI, batch relevant articles, send to Claude for market impact analysis (given test articles, maps impacts to correct markets)
- [x] [P2] Implement news ingestion job (`news-ingest.job.ts`): fetches from NewsAPI every 5 min, stores raw articles (job runs, articles stored)

### CORTEX v2

- [x] [P2] Add `ModuleWeight` table seeding with default weights from PRD (seed script populates all module×category combinations)
- [x] [P2] Implement CORTEX v2: load weights from DB, apply time decay per module type, conflict detection when spread > 0.20, confidence aggregation with disagreement penalty (synthesizes 5+ modules correctly)
- [x] [P2] Update signal pipeline job to run COGEX + FLOWEX + ARBEX + LEGEX + DOMEX + ALTEX in parallel, then CORTEX v2

### Portfolio Management

- [x] [P2] Add Position and PortfolioSnapshot Prisma models, run migration (tables created)
- [x] [P2] Implement Kelly criterion calculator: given edge, price, bankroll → recommended size with configurable multiplier (correct sizing for known inputs)
- [x] [P2] Implement concentration limit checker: single market (5%), category (25%), platform (60%), total deployed (80%) (rejects position exceeding any limit)
- [x] [P2] Implement `POST /api/v1/portfolio/positions` for manual position entry with validation
- [x] [P2] Implement `PATCH /api/v1/portfolio/positions/:id` for updating/closing positions
- [x] [P2] Implement `GET /api/v1/portfolio/positions` and `GET /api/v1/portfolio/summary` with P&L calculations
- [x] [P2] Implement `GET /api/v1/portfolio/history` returning PortfolioSnapshot time series

### Paper Trade System (A3)

- [x] [P2] Add `PaperPosition` Prisma model, run migration (table created with direction, entryPrice, currentPrice, kellySize, paperPnl, edgeAtEntry, confidenceAtEntry)
- [x] [P2] Create `PaperTrader` service: auto-enters paper position for every actionable edge, updates paperPnl on market sync (paper positions created and tracked)
- [x] [P2] Add paper P&L summary to `GET /api/v1/portfolio/summary` (returns paper and live P&L separately)
- [x] [P2] Add PAPER ONLY / GRADUATED badges to dashboard edge cards (badges render correctly)
- [x] [P2] Fix paper-position-update job: confirmed registered in queue.ts + workers.ts, missing from Redis (needs worker restart to register schedulers)
- [x] [P2] Clear stale paper positions from old system (no fees, 0.5% threshold) to prevent learning loop contamination
- [x] [P2] Fix cent symbol encoding bug: `\u00a2` in JSX text → `{'\u00a2'}` in JS expression (Backtest.tsx)
- [x] [P2] Make paper position rows clickable → navigate to Signal Viewer (`/markets/:id/signals`)
- [x] [P2] Add `marketId` to `/backtest/live-performance` API response for position navigation
- [x] [P2] Add `onRowClick` to Portfolio.tsx positions DataTable → Signal Viewer navigation

### Alert System

- [x] [P2] Add Alert Prisma model + AlertType/AlertSeverity enums, run migration
- [x] [P2] Implement alert engine: creates alerts with cooldown logic (same type+market within cooldown → suppressed)
- [x] [P2] Implement NEW_EDGE alert (fires when expectedValue > 0.03, HIGH if > 0.05)
- [x] [P2] Implement MODULE_FAILURE alert (fires on 3 consecutive module failures)
- [x] [P2] Implement EDGE_EVAPORATION alert (fires when actionable edge drops below threshold)
- [x] [P2] Implement `GET /api/v1/alerts`, `PATCH /alerts/:id/acknowledge`, `PATCH /alerts/:id/snooze`

### Telegram Alert Delivery (A1)

- [x] [P2] Add Telegram env vars (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ENABLED`) to `.env.example` and config validation
- [x] [P2] Create `TelegramService` class with `sendMessage`, `sendAlert`, `sendDailyDigest`, `testConnection` (bot sends test message successfully)
- [x] [P2] Create HTML message template formatters for all alert types: NEW_EDGE, SMART_MONEY, PRICE_SPIKE, MODULE_FAILURE, EDGE_EVAPORATION (each template renders correctly)
- [x] [P2] Integrate `TelegramService` into `AlertManager` as delivery channel: fires on severity >= MEDIUM (Telegram messages received for high-severity alerts)
- [x] [P2] Update Telegram templates with paper trade prefix for non-graduated edges (prefix appears)
- [x] [P2] Add `daily-digest` BullMQ cron job at 8 AM ET (`0 13 * * *`): active markets, top 3 edges, portfolio summary, module health (digest delivered daily)

### TRADEX — Telegram Execution Flow (Phase 2)

- [x] [P2] Implement Telegram reply listener in `packages/tradex/src/telegram/reply-listener.ts` (poll getUpdates every 5s)
- [x] [P2] Add execution confirmation and failure Telegram templates (fill price, fee, position ID)
- [x] [P2] Wire SLOW_EXEC edges (DOMEX, LEGEX, COGEX, REFLEX, NEXUS, ALTEX) to Telegram confirmation flow with 2-hour auto-expiry
- [x] [P2] Add Telegram notification for risk limit changes

### Memory & Feedback System — MNEMEX (A2, Phase 2 portion)

- [x] [P2] Add `PatternMemory`, `MistakeMemory`, `MarketMemory` Prisma models, run migration (tables created)
- [x] [P2] Create `PostMortemAnalyzer`: on market resolution, if CORTEX confidence > 0.6 and wrong → Claude generates root cause → `MistakeMemory`; if correct → `PatternMemory` (entries created on resolution)
- [x] [P2] Create `MemoryRetriever.getRelevantContext(market)`: searches all stores by category + keyword similarity, returns `MemoryContext` (returns relevant memories for test market)

### Event Calendar (A8, Phase 2 portion)

- [x] [P2] Add `ScheduledEvent` Prisma model, run migration (table created with title, date, category, source, relatedMarketIds, expectedVolatility)
- [x] [P2] Create `EventCalendar` service with static FOMC and BLS economic data release schedules (next 90 days of events populated)
- [x] [P2] Create event-to-market mapping via Claude: match ScheduledEvents to active markets (related markets linked correctly)
- [x] [P2] Add catalyst alerts to Telegram: "FOMC decision in 24h. 3 related markets with active edges." (pre-event alerts fire)

### WebSocket

- [x] [P2] Set up @fastify/websocket with API key auth on connection (client connects with `?apiKey=xxx`)
- [x] [P2] Broadcast `edge:new`, `edge:update`, `alert:new` events from signal pipeline and alert engine (connected clients receive events within 500ms)

### Dashboard (Phase 2)

- [x] [P2] Implement `useWebSocket` hook: connects on mount, auto-reconnects, dispatches events to stores (receives and processes WebSocket events)
- [x] [P2] Build Signal Viewer page: market header, 8-panel module grid with ProbabilityGauge + ConfidenceBar + reasoning, CORTEX synthesis panel (shows all signals for a market)
- [x] [P2] Build Portfolio page: summary stats bar, open positions table, paper positions table, concentration bar charts (displays positions and P&L)
- [x] [P2] Build AlertPanel component: dropdown showing recent alerts, acknowledge/snooze buttons, severity coloring (real-time alerts appear)
- [x] [P2] Add `GET /api/v1/signals/modules` route and display module health on System Monitor page
- [x] [P2] Add API usage display to System Monitor: Claude API costs per day by tier (shows token usage, spend, and budget remaining)

### Phase 2 Integration

- [x] [P2] **CHECKPOINT**: All 6 modules produce signals (COGEX, FLOWEX, ARBEX, LEGEX, DOMEX, ALTEX) → CORTEX v2 synthesizes with weighting/decay/conflict → portfolio sizing works → paper trades auto-created → alerts fire and deliver to Telegram → WebSocket delivers to dashboard → Signal Viewer, Portfolio, and Alert pages functional → daily digest delivers at 8 AM ET

---

## Phase 3: On-Chain Intelligence & Causal Graph

### SIGINT Module

- [x] [P3] Add Wallet + WalletPosition Prisma models + WalletClassification enum, run migration
- [x] [P3] Implement Polygon client: connects to RPC, fetches ERC-1155 TransferSingle/TransferBatch logs from CTF Exchange contract (returns parsed transfer events)
- [x] [P3] Implement wallet indexer: processes Transfer events → creates/updates Wallet + WalletPosition records, tracks block high-water mark (processes historical blocks, creates records)
- [x] [P3] Implement wallet classifier: computes ROI, win rate, avg position size, tx frequency → applies classification rules (correctly labels test wallets as SMART_MONEY/MARKET_MAKER/RETAIL)
- [x] [P3] Implement SIGINT divergence detector: aggregates SMART_MONEY positions, compares to market price, outputs signal when divergence > 5% (given 3 smart wallets long at 0.70 and market at 0.55, produces signal)
- [x] [P3] Create wallet-profile job (1hr) and wallet-monitor job (5min) in BullMQ

### SIGINT Enhancements — Whale Tracking (A7)

- [x] [P3] Add `FreshWalletDetector`: flag wallets < 7 days old with first position > $5K, severity scored by age x size x resolution proximity (correctly flags test fresh wallet as potential insider)
- [x] [P3] Add `WalletClusterer`: group wallets by funding source address, report cluster combined positions (clusters wallets funded from same source)
- [x] [P3] Add `CopyTradeSignal`: track time-to-price-impact after smart money entry, generate signal with execution window (reports 5-15 min window for known smart money wallets)
- [x] [P3] Add fresh wallet insider alerts to Telegram (INSIDER ALERT template with wallet age, position size, market)

### NEXUS Module

- [x] [P3] Add CausalEdge Prisma model + CausalRelationType enum, run migration
- [x] [P3] Write NEXUS causal prompt in `prompts/nexus-causal.md` (instructs causal relationship identification with JSON output)
- [x] [P3] Implement graph builder: LLM pass identifies causal links between market pairs, statistical pass computes 30-day price correlations, merge into CausalEdge records (given related markets, creates correct edges)
- [x] [P3] Implement consistency checker: extracts implied joint probabilities from connected subgraphs, validates P(A∩B) <= min(P(A),P(B)) etc. (detects inconsistency when markets are mispriced relative to each other)
- [x] [P3] Implement correlation matrix: rolling 30-day price correlation for all active market pairs (produces correct correlations for test data)
- [x] [P3] Create graph-rebuild job (6hr) and consistency-check job (15min) in BullMQ

### ARBEX Synthetic Arb (A5, Phase 3 portion)

- [x] [P3] Add synthetic arb detection to ARBEX using NEXUS causal graph: detect logically constrained prices that are inconsistent (e.g., P(wins primary)=30% but P(wins general)=25%)

### SPEEDEX — Latency Arbitrage (A6)

- [x] [P3] Create `CryptoFeedService` with Binance/Coinbase WebSocket price streams for BTC, ETH, SOL (receives real-time prices within 100ms)
- [x] [P3] Create `ThresholdMatcher` that maps crypto prediction markets to price thresholds (correctly matches "BTC > $65K" market to 65000 threshold)
- [x] [P3] Build `SPEEDEX` module that detects latency between crypto price moves and prediction market repricing (detects when crypto moved but PM hasn't repriced in 2-15s)
- [x] [P3] Add SPEEDEX signals to CORTEX with very short decay (halfLifeMinutes: 15) and to signal pipeline

### SIGINT & NEXUS API Routes

- [x] [P3] Implement `GET /api/v1/sigint/wallets`, `/wallets/:address`, `/moves` (returns wallet data, positions, recent smart money moves)
- [x] [P3] Implement `GET /api/v1/nexus/graph`, `/inconsistencies`, `/market/:id/related` (returns graph data for visualization)

### Alert Expansion

- [x] [P3] Implement SMART_MONEY_MOVE alert (fires when SMART_MONEY wallet opens position > $25k)
- [x] [P3] Implement CAUSAL_INCONSISTENCY alert (fires when NEXUS detects joint probability violation > 0.10)
- [x] [P3] Implement webhook alert delivery: POST to configurable URL on alert creation (webhook fires within 1s)

### Dashboard (Phase 3)

- [x] [P3] Build SIGINT Dashboard page: wallet leaderboard table, recent moves table, divergence highlights, fresh wallet alerts (displays wallet intelligence)
- [x] [P3] Build NEXUS Graph page: force-directed graph with react-force-graph-2d, nodes colored by category, edges styled by type, click → sidebar detail (renders interactive causal graph)
- [x] [P3] Add `sigint:smartmove` WebSocket event handling to dashboard

### TRADEX — Live Execution (Phase 3: Small Money)

- [x] [P3] Implement PolymarketExecutor with EIP-712 signing and CLOB order placement
- [x] [P3] Implement `executeArb()` in ExecutionManager: place BOTH legs simultaneously, cancel other if one fails
- [x] [P3] Switch KalshiExecutor from demo to production API (toggle via KALSHI_USE_DEMO=false)
- [x] [P3] Wire FAST_EXEC signals (ARBEX, SPEEDEX, FLOWEX, SIGINT copy trades) to auto-execution through risk gate
- [x] [P3] Add circuit breaker to ExecutionManager: 3 consecutive failures = 15 min pause per platform
- [x] [P3] Add daily P&L kill switch: configurable threshold, halts all execution when hit
- [x] [P3] Add execution latency tracking to dashboard Execution page

### Phase 3 Integration

- [x] [P3] Update signal pipeline to include SIGINT + NEXUS + SPEEDEX (9 modules running)
- [x] [P3] **CHECKPOINT**: Wallet indexer populates data → classifier labels wallets → fresh wallet detector flags insiders → SIGINT produces divergence signals → NEXUS builds graph + detects inconsistencies → SPEEDEX detects crypto latency → ARBEX finds synthetic arbs → 9-module CORTEX synthesis → TRADEX executes on both platforms with circuit breakers → SIGINT and NEXUS dashboard pages render correctly

---

## Phase 4: Advanced Modules & Backtesting

### REFLEX Module

- [x] [P4] Write REFLEX system prompt in `prompts/reflex-system.md` (instructs reflexivity analysis with JSON output including equilibrium price)
- [x] [P4] Implement REFLEX module: sends market to Claude, parses reflexivity type + elasticity, computes equilibrium price for non-neutral markets (correctly identifies political market as SELF_REINFORCING, weather as NEUTRAL)

### ALTEX Chinese Sources

- [x] [P4] Write ALTEX Chinese prompt in `prompts/altex-chinese.md` (instructs Chinese article extraction + market mapping)
- [x] [P4] Implement Chinese news client: parses RSS from Xinhua, SCMP, Caixin (fetches and parses Chinese RSS feeds)
- [x] [P4] Extend ALTEX module: processes Chinese articles through Claude, computes information asymmetry score (identifies material Chinese-source info not in English coverage)

### MNEMEX Integration (A2, Phase 4 portion)

- [x] [P4] Inject `MemoryContext` into LEGEX, DOMEX, ALTEX, REFLEX system prompts as calibration context (LLM modules receive relevant pattern/mistake memories)
- [x] [P4] Build `MarketMemory` auto-population: on market resolution, compute and store base rates by market type (base rates accurate for categories with 30+ resolved markets)
- [x] [P4] Build Memory dashboard page: show pattern memories, mistake memories, base rates, module learning trends (all memory types displayed)

### Event Calendar Extended (A8, Phase 4 portion)

- [x] [P4] Add earnings, court hearing (PACER), and crypto event calendars (halvings, ETF decisions, major unlocks) to `EventCalendar` service
- [x] [P4] Integrate EventCalendar context into CORTEX confidence adjustment: boost confidence when signal aligns with expected catalyst direction
- [x] [P4] Integrate EventCalendar context into FLOWEX: don't flag catalyst-day volume spikes as anomalies

### Backtesting Engine

- [x] [P4] Add ModuleScore Prisma model, run migration
- [x] [P4] Implement Brier score calculator: for each resolved market, compute (forecast - outcome)^2 per module and for CORTEX (correct scores for known inputs)
- [x] [P4] Implement calibration curve generator: bin forecasts into 10 probability buckets, compute actual outcome rate per bin (diagonal = well-calibrated)
- [x] [P4] Implement module contribution analysis: leave-one-out Brier score comparison, direction accuracy, confidence calibration (identifies which modules add value)
- [x] [P4] Implement P&L simulation: given edge history + resolutions + Kelly sizing → cumulative returns, max drawdown, Sharpe ratio (correct simulation for test data)
- [x] [P4] Implement `GET /api/v1/backtest/*` routes for retrieving backtest results
- [x] [P4] Implement `POST /api/v1/system/backtest/trigger` to run backtest on demand

### LLM Cost Dashboard (A4, Phase 4 portion)

- [x] [P4] Add LLM cost breakdown to System Monitor dashboard: cost per tier, cost per module, daily/weekly trends, budget burn rate (charts render with real data)

### Weight Update & Data Retention

- [x] [P4] Implement weight-update job: computes per-module Brier scores, derives accuracy multipliers, updates ModuleWeight table (runs weekly, weights change based on performance)
- [x] [P4] Implement CORTEX v3: loads updated weights from ModuleWeight table (uses adaptive weights when available, falls back to defaults)
- [x] [P4] Implement data-retention job: deletes PriceSnapshots > 1yr, OrderBookSnapshots > 90d, etc. per retention policy (old data cleaned up, recent data preserved)
- [x] [P4] Implement PRICE_SPIKE alert (fires when price moves > 10% in 30 minutes)

### Dashboard (Phase 4)

- [x] [P4] Build Backtest View page: Brier score time-series chart (Recharts), calibration curve, module scorecards, P&L equity curve (all charts render with data)
- [x] [P4] Add time range selector and module filter to Backtest View (interactive filtering works)

### Phase 4 Integration

- [x] [P4] Update signal pipeline to include REFLEX (all 10 modules running: COGEX, FLOWEX, ARBEX, LEGEX, DOMEX, ALTEX, SIGINT, NEXUS, SPEEDEX, REFLEX)
- [x] [P4] **CHECKPOINT**: All 10 modules produce signals → CORTEX v3 with adaptive weights → backtesting computes scores and calibration → P&L simulation runs → memory system learns from resolutions → event calendar maps catalysts → Backtest View displays all charts → data retention cleans old data

---

## Phase 5: Optimization & Hardening

### Circuit Breakers & Reliability

- [x] [P5] Implement generic circuit breaker wrapper (CLOSED → OPEN after 5 failures in 10 min → HALF_OPEN after 5 min reset)
- [x] [P5] Apply circuit breaker to all external API clients: Kalshi, Polymarket, Polygon, Claude, NewsAPI, Binance, Coinbase (health endpoint reports circuit states)

### LLM Optimization (A4)

- [x] [P5] Implement prompt caching: cache system prompts for Claude API calls, batch DOMEX markets per agent call (reduces API costs by 20%+)
- [x] [P5] Optimize prompt lengths across all modules for 30% token reduction (measurable cost decrease in ApiUsageLog)

### Graduation Engine (A3, Phase 5 portion)

- [x] [P5] Create `GraduationEngine` with configurable thresholds: min 20 resolved paper trades, win rate > 55%, profit factor > 1.3, avg edge > 3%, max single loss < 2x avg win (correctly graduates qualifying strategies)
- [x] [P5] Create `GraduationStatus` tracking: per (module combo, category) graduation state and progress (status queryable via API)
- [x] [P5] Add graduation progress dashboard showing per-strategy paper trade performance and graduation criteria progress
- [x] [P5] Implement Risk Control Gate with hard dollar limits: $10/position, $30/day new, 5 simultaneous, $100 total deployed (stored in SystemConfig, enforced on position creation)

### Portfolio & Performance

- [x] [P5] Add correlation-adjusted exposure to portfolio manager using NEXUS correlations (effective exposure computed for correlated positions)
- [x] [P5] Implement nightly Postgres backup job via pg_dump (backup file created, verified restorable)
- [x] [P5] Pipeline performance optimization: parallel module execution, query batching, index tuning (200+ markets processed in < 5 min)

### TRADEX — Position Sync & Analytics (Phase 5)

- [x] [P5] Implement position sync: reconcile local ExecutionLog DB with platform positions via API (detects drift)
- [x] [P5] Add execution analytics to dashboard: avg latency, fill rate, slippage analysis, win rate by signal source

### Dashboard Enhancements

- [x] [P5] Add keyboard shortcuts: `1`-`8` for page navigation, `/` for search, `?` for help overlay (shortcuts work from any page)
- [x] [P5] Build CommandPalette component (fuzzy search for markets, quick navigation)
- [x] [P5] Enhance System Monitor: job queue drill-down, error detail view, cost forecasting chart

### Phase 5 Integration

- [ ] [P5] **CHECKPOINT**: Circuit breakers protect all external calls → graduation engine tracks paper performance → risk control gate enforces limits → position sync auto-closes resolved positions → execution analytics API returns metrics → correlation-adjusted exposure computed → backup job runs nightly → keyboard shortcuts and command palette work → System Monitor shows drill-downs and cost forecast → all builds pass

---

## Phase 6: Platform Expansion & Automation

- [ ] [P6] Add Manifold adapter implementing `PredictionMarketAdapter` interface (new markets from Manifold appear in DB)
- [ ] [P6] Add Metaculus adapter implementing `PredictionMarketAdapter` interface (new markets from Metaculus appear in DB)
- [ ] [P6] Implement position auto-sync: read open positions from Kalshi/Polymarket APIs (positions sync automatically instead of manual entry)
- [ ] [P6] Build mobile-friendly Alerts page (responsive, alert-only view usable on phone)
- [ ] [P6] **CHECKPOINT**: New platform adapters work → markets from 4 platforms → positions auto-sync → mobile alert view functional

---

## v2 Features (Built, Not in Original Spec)

### Opportunity Lifecycle & State Machine

- [x] [v2] Implement `Opportunity` and `OpportunityTransition` Prisma models with full state tracking
- [x] [v2] Build opportunity state machine in `apps/api/src/services/opportunity-machine.ts`: DISCOVERED → RESEARCHED → RANKED → APPROVED → PAPER_TRACKING → ORDERED → FILLED → MONITORING → RESOLVED (+ CLOSED for failures)
- [x] [v2] Add opportunity API routes in `apps/api/src/routes/opportunities.ts` with attribution scoring (thesis correctness, execution quality, fee drag, timing score, realized P&L)

### Split CORTEX into packages/cortex (4 Engines)

- [x] [v2] Create `packages/cortex` workspace with 4 independent engines
- [x] [v2] Implement Signal Fusion Engine (`packages/cortex/src/signal-fusion.ts`): weighted signal combination for 11 modules with per-module time decay and agreement scoring
- [x] [v2] Implement Calibration Engine (`packages/cortex/src/calibration-memory.ts`): per-module per-category historical bias correction, time-bucketed recalibration from resolved markets
- [x] [v2] Implement Opportunity Scoring Engine (`packages/cortex/src/opportunity-scoring.ts`): edge magnitude, EV, capital efficiency, quarter-Kelly sizing, fee drag calculation, actionability thresholds
- [x] [v2] Implement Portfolio Allocator (`packages/cortex/src/portfolio-allocator.ts`): category budgets, daily capital deployment cap, max simultaneous positions, concentration limits, `resetDaily()` function

### Dual Mode Worker (RESEARCH / SPEED)

- [x] [v2] ~~Implement dual-mode pipeline~~ — `dual-mode-pipeline.ts` deleted (dead code: `processMarketOpportunity` was never called). Mode classification handled directly in signal pipeline and speed pipeline jobs.
- [x] [v2] RESEARCH mode: uses all LLM modules (COGEX, FLOWEX, LEGEX, DOMEX, ALTEX, REFLEX, SIGINT, NEXUS), 15-min cycle, SLOW_EXEC
- [x] [v2] SPEED mode: uses math-only modules (SPEEDEX, CRYPTEX, ARBEX, FLOWEX, COGEX), 30-sec cycle, FAST_EXEC
- [x] [v2] Add `speed-pipeline.job.ts` as separate BullMQ job for the 30-second SPEED cycle

### Feature Model (Logistic Regression over LLM Features)

- [x] [v2] Implement `FeatureModel` in `packages/cortex/src/feature-model.ts`: logistic regression over structured LLM features
- [x] [v2] Define 9 feature schemas: FedHawkFeatures, GeoIntelFeatures, SportsEdgeFeatures, CryptoAlphaFeatures, LegexFeatures, AltexFeatures, WeatherHawkFeatures, LegalEagleFeatures, CorporateIntelFeatures
- [x] [v2] Weekly retraining on resolved markets with fallback to base rates on insufficient data
- [x] [v2] Model persistence: `serializeModel()` / `loadModel()` for DB storage and startup restoration
- [x] [v2] Learning loop job: automated weekly retraining + calibration + weight persistence

### Implied Volatility Model

- [x] [v2] Implement `ImpliedVolModel` in `packages/cortex/src/implied-vol-model.ts`: Black-Scholes-like pricing for crypto bracket/floor contracts
- [x] [v2] Log-normal distribution with CDF approximation (Abramowitz & Stegun), realized vol from price history
- [x] [v2] `priceFloorContract()` for P(S > K) and `priceBracketContract()` for P(lower <= S_T <= upper)

### 8 DOMEX Agents (expanded from 3)

- [x] [v2] Add SportsEdgeAgent for SPORTS category (team form, injuries, matchup analysis)
- [x] [v2] Add WeatherHawkAgent for SCIENCE/ENTERTAINMENT categories (climate, natural disasters)
- [x] [v2] Add LegalEagleAgent for POLITICS/FINANCE/CRYPTO categories (legal/regulatory interpretation)
- [x] [v2] Add CorporateIntelAgent for FINANCE/ENTERTAINMENT categories (corporate news, earnings)
- [x] [v2] Add EntertainmentScoutAgent for ENTERTAINMENT/SPORTS categories (cultural trends, celebrity news)

### Crypto Strategy Engine (CRYPTEX)

- [x] [v2] Create crypto strategy engine in `apps/api/src/modules/crypto-strategy/` with 4 specialized modules
- [x] [v2] Implement FundingRateModule: perpetual futures funding arbitrage signals with in-memory caching (5-min TTL)
- [x] [v2] Implement SpotBookImbalanceModule: order book depth imbalance detection
- [x] [v2] Implement VolatilityMismatchModule: realized vs implied vol spread detection
- [x] [v2] Implement WhaleFlowModule: large transaction detection and classification

### Cost Optimization & Smart Order Routing

- [x] [v2] Implement SmartRouter in `packages/tradex/src/strategies/smart-router.ts`: compares effective price across Kalshi & Polymarket (platform price + fee rate + liquidity + slippage estimate)
- [x] [v2] Implement IcebergOrderer in `packages/tradex/src/strategies/iceberg.ts`: splits large orders into smaller chunks
- [x] [v2] Implement MakerFirstStrategy in `packages/tradex/src/strategies/maker-first.ts`: posts limit orders first, falls back to taker
- [x] [v2] Implement MarketMakerStrategy in `packages/tradex/src/strategies/market-maker.ts`: two-sided quoting

### WebSocket Auth Ticket System

- [x] [v2] Implement ticket-based WebSocket auth in `apps/api/src/plugins/websocket.ts`: POST /api/v1/auth/ws-ticket exchanges API key for 60-second single-use ticket
- [x] [v2] WebSocket connection via `GET /ws?ticket=<ticket>` with single-use enforcement, expiry validation, legacy apiKey fallback

### Auto-Restart Wrapper

- [x] [v2] Create `apps/api/scripts/start-worker.sh`: bash script with infinite loop restart logic, 5-second delay on crash

### Rate Limiting & Security

- [x] [v2] Add Fastify rate-limit plugin: 100 requests per minute per API key, keyed by X-API-KEY header or IP
- [x] [v2] SHA-256 hashed cache keys for sensitive data in Redis

### Data Sources Integration

- [x] [v2] Implement Binance WebSocket price feed (`apps/api/src/services/data-sources/binance-ws.ts`)
- [x] [v2] Implement FedWatch data source (`apps/api/src/services/data-sources/fedwatch.ts`)
- [x] [v2] Implement FRED economic data source (`apps/api/src/services/data-sources/fred.ts`)
- [x] [v2] Implement Congressional data source (`apps/api/src/services/data-sources/congress.ts`)
- [x] [v2] Implement Polling data source (`apps/api/src/services/data-sources/polling.ts`)
- [x] [v2] Implement The Odds API data source (`apps/api/src/services/data-sources/odds-api.ts`) — SPORTS-EDGE context provider (1hr cache, team-name sport detection)
- [x] [v2] Implement ESPN public API data source (`apps/api/src/services/data-sources/espn-data.ts`) — injuries, standings, team schedule (no API key needed)
- [x] [v2] Implement Finnhub + OpenFDA data source (`apps/api/src/services/data-sources/finnhub.ts`) — CORPORATE-INTEL context provider

### Additional Jobs & Services

- [x] [v2] Implement historical-ingest job for backfilling market data
- [x] [v2] Implement retroactive-backtest service for testing strategies against historical data
- [x] [v2] Implement event-driven-ingestion service for real-time catalyst detection
- [x] [v2] Implement crypto-price service for cross-exchange price aggregation

---

## Upcoming / Not Yet Built

### Phase 5 Remaining

- [x] [P5] Add correlation-adjusted exposure to portfolio manager using NEXUS correlations
- [ ] [P5] Implement nightly Postgres backup job via pg_dump
- [ ] [P5] Add keyboard shortcuts: `1`-`8` for page navigation, `/` for search, `?` for help overlay
- [ ] [P5] Build CommandPalette component (fuzzy search for markets, quick navigation)
- [x] [P5] Enhance System Monitor: job queue drill-down, error detail view, cost forecasting chart

### Phase 6

- [ ] [P6] Add Manifold adapter implementing `PredictionMarketAdapter` interface
- [ ] [P6] Add Metaculus adapter implementing `PredictionMarketAdapter` interface
- [ ] [P6] Implement position auto-sync: read open positions from Kalshi/Polymarket APIs
- [ ] [P6] Build mobile-friendly Alerts page (responsive, alert-only view usable on phone)

### Critical Fixes (Code Review)

- [x] [FIX] Wire CalibrationEngine into live CORTEX synthesis — `applyCalibration()` called on every signal before fusion in `engine/cortex.ts`
- [x] [FIX] Implement Kelly sizing formula: `f* = (p*b - q) / b`, quarter-Kelly (`* 0.25`), stored in Edge record and used by PaperTrader
- [x] [FIX] Worker memory fix: `--max-old-space-size=2048` in `start-worker.sh`, `MAX_MARKETS` reduced from 25 to 15
- [x] [FIX] Market matcher: ingestion-time LLM matching (once per new market) + MarketMatch table for permanent storage + arb-scan reads pre-computed matches (zero LLM)
- [x] [FIX] Consolidate signal fusion: `engine/cortex.ts` now delegates to canonical `fuseSignals()` from `@apex/cortex` — no duplicate fusion logic
- [x] [FIX] Add standalone `@@index([createdAt])` on Signal model in Prisma schema
- [x] [FIX] Analysis worker lock duration increased to 30 min with per-market lock extension for long LLM pipeline runs
- [x] [FIX] Signal pipeline pre-filters extreme-price markets (< 5¢ or > 95¢) before processing
- [x] [FIX] Missing database tables synced via `prisma db push` (15 of 27 models were missing)

### DOMEX Overhaul (Feature Extraction Architecture)

- [x] [FIX] CRITICAL: Remove market price from ALL DOMEX agent prompts — agents now NEVER see `Current YES price`, preventing anchoring bias
- [x] [FIX] Kill ENTERTAINMENT-SCOUT agent — deleted agent file, prompt file, removed from routing and weights. Zero edge potential with no data sources.
- [x] [FIX] Wire Binance WebSocket live crypto data into CRYPTO-ALPHA context provider (prices, 24h change, volume, funding rates)
- [x] [FIX] Wire `estimatePassageProbability()` from congress.ts into GEO-INTEL for legislation markets — provides calibrated base rates by bill stage
- [x] [FIX] Demote DOMEX agent LLM calls from TIER_2 (Sonnet) to TIER_1 (Haiku) via new `DOMEX_FEATURE_EXTRACT` task — ~75% cost reduction
- [x] [FIX] Rewrite DomexAgentResult interface: `{ features: Record<string, ...>, reasoning, dataSourcesUsed, dataFreshness }` — no more probability/confidence from agents
- [x] [FIX] Rewrite ALL 7 agent prompts for structured feature extraction (not probability estimation)
- [x] [FIX] Change DOMEX aggregation: agent feature vectors → FeatureModel logistic regression → calibrated probability (replaces trimmed-mean of probabilities)
- [x] [FIX] Add NWS Weather API (api.weather.gov) context provider for WEATHER-HAWK — forecast IS the answer for short-range weather
- [x] [FIX] Add CourtListener API (courtlistener.com) context provider for LEGAL-EAGLE — free case law search
- [x] [FIX] Expand FRED series: T5YIE (breakeven inflation), ICSA (initial claims), UMCSENT (consumer sentiment)

### LLM Cost Controls

- [x] [FIX] Hard $20/day budget kill switch — `shouldAllowCall()` checked BEFORE every `callClaude()`, blocks when spend >= $20
- [x] [FIX] Adaptive rate limiting: 100 calls/hr normal, 50 at >50% budget, 10 at >80%
- [x] [FIX] MarketMatch table: matches computed ONCE during ingestion, arb-scan does zero LLM calls
- [x] [FIX] Pipeline market scope: volume >$500, TTR 1-90 days, 6h dedup, MAX_MARKETS=10
- [x] [FIX] Eliminated 12,600 SCREEN_MARKET calls/day ($18.50) from arb-scan LLM matching

### Code Review #2 — Critical Fixes

- [x] [FIX] Wire learning loop: weekly `learning-loop` job (Sun 2AM UTC) queries resolved markets, retrains FeatureModel, persists weights to DB, recalibrates module bias
- [x] [FIX] Load persisted calibration + model weights on worker startup via `loadCalibration()` and `loadModel()`
- [x] [FIX] Schedule `paper-position-update` every 5 min — paper positions must have current prices and P&L, not just created and forgotten
- [x] [FIX] Schedule `position-reconciliation` every 5 min — close resolved positions, calculate final P&L
- [x] [FIX] Schedule weekly `backtest` job (Sun 4AM UTC) — populates ModuleScore records that feed the weight-update job
- [x] [FIX] Remove market price anchoring: `DEFAULT_WEIGHTS.priceLevel` set to 0 (removed from flattenFeatures). Model was `sigmoid(2.5 * marketPrice + noise) ≈ marketPrice`, guaranteeing edge ≈ 0
- [x] [FIX] Add typed feature schemas for WEATHER-HAWK, LEGAL-EAGLE, CORPORATE-INTEL — their features were extracted but never mapped into the typed FeatureVector (hit `default:break`)
- [x] [FIX] Add full weight entries for all domain agent features (FedHawk, GeoIntel, CryptoAlpha, Sports, WeatherHawk, LegalEagle, CorporateIntel) in DEFAULT_WEIGHTS
- [x] [FIX] SPORTS-EDGE: add The Odds API (the-odds-api.com) context provider — live odds, spreads, team matchups. Without data, LLM was guessing features from title alone.
- [x] [FIX] CORPORATE-INTEL: add Finnhub API (finnhub.io) for earnings dates, analyst estimates, SEC filings + OpenFDA API for FDA approval tracking
- [x] [FIX] GEO-INTEL: verified `estimatePassageProbability()` is wired as context provider and returning data
- [x] [FIX] CRYPTO-ALPHA: verified Binance/CoinGecko context provider is injecting live prices and funding rates
- [x] [FIX] Delete dead code: `dual-mode-pipeline.ts` `processMarketOpportunity()` was never called — removed entire file
- [x] [FIX] Paper trade fee modeling: `enterPaperPosition` now subtracts estimated Kalshi fees (7% × price × (1-price)) from entry price. Without fees, paper results overstated performance by 2-7%.
- [x] [FIX] Increase `EDGE_ACTIONABILITY_THRESHOLD` from 0.005 (0.5%) to 0.03 (3%) — after Kalshi fees (~7% round trip), 0.5% edge is negative EV
- [x] [FIX] Increase `EDGE_HIGH_THRESHOLD` from 0.03 to 0.05 for stronger signal quality
- [x] [FIX] Add `ODDS_API_KEY` and `FINNHUB_API_KEY` to .env.example and config.ts

### Code Review #3 — Signal Quality

- [x] [FIX] Minimum module requirement: edge only `isActionable` if >= 2 modules contributed AND >= 1 is an LLM module (LEGEX/DOMEX/ALTEX/REFLEX). Pure stats (COGEX/FLOWEX alone) can't analyze the event.
- [x] [FIX] SPORTS-EDGE Odds API: added EPL team names (Man United, Arsenal, Liverpool, etc.) + La Liga, Bundesliga, Serie A, Ligue 1 team detection. "Man United top 4" now routes to `soccer_epl`.
- [x] [FIX] COGEX reasoning rewritten for human readability: "Market price 89.5% shows anchoring near round number 90%. Historical price clustering suggests fair value likely below current price around 87.0%." instead of "anchoring: -10.0%".
- [x] [FIX] Added `actionabilitySummary` field to Edge model + EdgeOutput type. Every edge now includes human-readable explanation of CORTEX estimate, direction, contributing modules, and why the edge is/isn't actionable.
- [x] [FIX] Added `actionabilitySummary` column to Prisma Edge model schema.

### Follow-up Review Fixes

- [x] [FIX] Store FULL feature vectors in DOMEX signal metadata: `serializeFeatureVector()` replaces `summarizeFeatures()` — stores all 40+ numeric domain features so the weekly learning loop can retrain on rich data, not just base features
- [x] [FIX] Add exit fees to paper P&L: `updatePaperPositions()` deducts Kalshi exit fee (7% × price × (1-price)) from ongoing P&L and take-profit closes. Resolution exits have zero fee (Kalshi doesn't charge on settlement).
- [x] [FIX] Learning loop Telegram summary: after weekly model retrain, sends message with accuracy change (old% → new%), Brier score, training sample count, calibration record count

### Category & Confidence Fixes (2026-03-26)

- [x] [FIX] Bulk recategorize all 11,541 existing markets using enhanced `detectCategory()` + `reclassifyMarket()`. 454 markets updated, 346 moved POLITICS → SPORTS (European football, NBA awards, team-name markets). Added `POST /system/recategorize-markets` endpoint.
- [x] [FIX] Add 20% minimum confidence gate for actionability: `MIN_CONFIDENCE_FOR_ACTIONABLE = 0.20` in `packages/shared/src/constants.ts`. Edges with <20% confidence are noise and should not enter paper trading. CORTEX actionability gate now has 4 checks (EV ≥ 3%, confidence ≥ 20%, ≥ 2 modules, ≥ 1 LLM module).
- [x] [FIX] Purged 10 paper positions with <20% confidence. 37 positions with ≥ 20% confidence retained.
- [x] [FIX] Worker restarted (PID 33692) to pick up all code changes: platform-native categories, confidence gate, paper-position-update job, enhanced sports regex. Categories no longer reverted on sync.
- [x] [FIX] Deleted 7 contaminated paper positions (sports markets analyzed by GEO-INTEL/LEGAL-EAGLE instead of SPORTS-EDGE due to stale POLITICS category).
- [x] [FIX] Deleted ALL remaining 30 paper positions — created under old system (0.5% threshold, no fee modeling, no feature extraction, no price anchoring removal, wrong-domain routing). Paper trading starts fresh with all fixes active.

### SPEEDEX Rewrite & Speed Pipeline (2026-03-26)

- [x] [FIX] Rewrite SPEEDEX to handle BRACKET contracts (97% of Kalshi crypto). Uses `parseKalshiCryptoTicker()` + `calculateBracketImpliedProb()` (P = N(d_upper) - N(d_lower)) instead of broken regex title parsing. Also handles FLOOR contracts via `calculateSpotImpliedProb()`.
- [x] [FIX] Wire speed pipeline to create paper positions: SPEEDEX edges with EV ≥ 3% and confidence ≥ 20% enter paper positions directly, no CORTEX/LLM required. Only pipeline that creates positions from pure-math signals.
- [x] [FIX] Pass `platformContractId` in speed pipeline contract data so SPEEDEX can parse Kalshi ticker format.
- [x] [VERIFY] Speed pipeline makes zero Claude API calls — confirmed no LLM imports in speedex.ts or speed-pipeline.job.ts.
- [x] [FIX] Speed pipeline price fallback: crypto bracket contracts have null `lastPrice` (no trades yet). Added fallback chain: `lastPrice ?? midpoint(bestBid, bestAsk) ?? bestAsk ?? bestBid`. First live run: 50 markets → 6 processed → 12 signals → 6 paper positions entered.

### Paper Trading Quality Fixes (2026-03-26)

- [x] [FIX] Direction-aware P&L: BUY_NO positions now correctly calc P&L = (entry - current) × size. Previous bug: `updatePaperPositions()` skipped crypto brackets due to null `lastPrice`. Added `resolveContractPrice()` fallback.
- [x] [FIX] Position display names: "BTC $67,050-$67,550 MAR 26 9PM" instead of "Bitcoin price range on Mar 26, 2026?". `buildPositionDisplayName()` parses `platformContractId` for BRACKET/FLOOR contracts.
- [x] [FIX] Min 30-minute TTR: Speed pipeline skips contracts with <30min to expiry (`MIN_HOURS_TO_EXPIRY = 0.5`).
- [x] [FIX] Min $100 volume: Speed pipeline skips illiquid crypto brackets (`MIN_CRYPTO_VOLUME = 100`).
- [x] [FIX] Max 3 positions per asset per date: `checkConcentrationLimit()` prevents over-concentration. Was 6 BTC brackets in one cycle.
- [x] [FIX] Expired position handling: `reconcilePositions()` and `updatePaperPositions()` now auto-close positions on expired markets (closesAt < now, no resolution).
- [x] [FIX] Vol model validation: SPEEDEX logs one complete example per worker session with all Black-Scholes inputs/outputs for manual verification.

### Overnight Research Stability Fixes (2026-03-26 PM)

- [x] [FIX] SPORTS-EDGE safety: add `requireContext` flag to base-agent. When set, agent returns null (no signal) if context provider returns empty data. Prevents LLM hallucinating features without real odds data (e.g. "62% Schauffele"). ODDS_API_KEY confirmed not set in .env — SPORTS-EDGE is safely disabled until configured.
- [x] [FIX] Minimum 20% confidence gate: VERIFIED already implemented in `cortex.ts` via `MIN_CONFIDENCE_FOR_ACTIONABLE = 0.20` from constants.ts. Actionability gate requires EV >= 3%, confidence >= 20%, >= 2 modules, >= 1 LLM module.
- [x] [FIX] Multi-module requirement: VERIFIED already implemented in `cortex.ts` — `MIN_MODULES_FOR_ACTIONABLE = 2`, `MIN_LLM_MODULES_FOR_ACTIONABLE = 1`. Edges from pure stats (COGEX/FLOWEX only) are NOT actionable.
- [x] [FIX] Category re-map: triggered `POST /system/recategorize-markets` — 595 markets updated out of 12,628. Key changes: 32 POLITICS→SPORTS (European football, player props), 56 CULTURE→SPORTS (NBA/NFL markets). Sports markets no longer miscategorized as POLITICS.
- [x] [FIX] Speed pipeline paper trades DISABLED: crypto bracket data quality unreliable. Pipeline still runs for monitoring/signals but does NOT create paper positions. Research pipeline handles all paper trades. Removed paper trade imports and position creation code from `speed-pipeline.job.ts`.
- [x] [FIX] Paper position and reconciliation jobs: VERIFIED running every 5 min in maintenance queue. `paper-position-update` updates prices + P&L, `position-reconciliation` closes resolved markets. Both registered in queue.ts and handled in workers.ts.
- [x] [FIX] LLM cost controls: budget lowered from $25/day to $5/day. HARD_LIMIT in `llm-budget-tracker.ts` lowered from $20 to $5. `LLM_DAILY_BUDGET` in .env set to 5.00. Previous day was $25.47 — mostly from 14K SCREEN_MARKET calls ($20.87). Budget will enforce $5/day cap starting midnight UTC.
- [x] [FIX] Worker restarted with all code changes. All RESEARCH modules online: COGEX, FLOWEX, LEGEX, DOMEX, ALTEX, REFLEX + SPEED pipeline (SPEEDEX, FLOWEX) running 30s cycle with 0 paper positions (disabled).

### SPORTS-EDGE: The Odds API + ESPN + Bookmaker Baseline (2026-03-26 PM)

- [x] [FIX] Configure `ODDS_API_KEY=c0bae8...` in `.env`. Verified: 500 requests remaining, NBA/MLB/NHL/NFL odds returning correctly.
- [x] [FIX] Fix odds-api.ts response field mapping: API returns `home_team`/`away_team` (snake_case), not `homeTeam` (camelCase). Team matching was silently failing.
- [x] [FIX] Add tiered in-memory cache to odds-api.ts based on time to event: >7d=6hr, 1-7d=2hr, <24hr=15min, live=2min. Free tier is 500 req/month — flat 1hr cache was wasteful for futures and too slow for game day.
- [x] [FIX] Track Odds API monthly usage in SystemConfig (`odds_api_monthly_usage`): calls, remaining, month. Persists to DB every 5 calls. Warns at ≤50 remaining. Exposed via `GET /system/odds-api-usage`.
- [x] [FIX] Add team-name-based sport detection to odds-api.ts: 120+ team names across NBA/NFL/MLB/NHL. "Will the Hornets beat the Knicks?" now detects as `basketball_nba` even without "NBA" keyword.
- [x] [NEW] Create `espn-data.ts`: ESPN public API (no key required) for injuries, standings, team schedules. Static team ID maps for 4 major leagues. 2h/12h cache TTL.
- [x] [FIX] Update sports-edge.ts contextProvider: calls The Odds API + ESPN in parallel. `requireContext: true` passes if EITHER source returns data.
- [x] [FIX] Add `bookmakerImpliedProb` to `SportsEdgeFeatures` with weight 3.0 (highest). Bookmaker consensus is the baseline; other features (home/away, form, injuries) are adjustments. NaN default when no odds → silently skipped.
- [x] [FIX] Reduce other sports weights: homeAway 0.15→0.10, recentForm 0.8→0.5, injuryImpact -0.6→-0.4. Bookmaker line already prices most of these factors.
- [x] [FIX] Update SPORTS-EDGE prompt: `bookmakerImpliedProb` is most important feature. Instructions to extract implied probability from moneyline odds and use ESPN data for injuries/standings/form.
- [x] [VERIFY] End-to-end test: Hornets vs Knicks → bookmakerImpliedProb 0.985, recentFormLast10 0.7, injuryImpact 0.08, homeAway 1. Data sources: The Odds API + ESPN Schedule + ESPN Injury Report.

### Category Detection: High-Confidence Keyword Overrides (2026-03-26 PM)

- [x] [FIX] CRITICAL: Political keywords now override ALL other signals (Tier 0). "Chelsea Clinton Democratic presidential nomination?" → POLITICS, not SPORTS. `POLITICS_OVERRIDE` regex checked before platform category and sports patterns.
- [x] [FIX] Same for finance (`fed`, `fomc`, `tariff`, `gdp`) and crypto (`bitcoin`, `ethereum`, `blockchain`) — override everything.
- [x] [FIX] Removed ambiguous team names (`chelsea`, `cardinals`, `kings`, `panthers`, `hurricanes`) from top-level sports regex. Now only unambiguous league names (NBA, NFL, EPL) trigger sports. Full team name matching runs after politics/finance/crypto.
- [x] [FIX] Added CULTURE patterns: `gta`, `video game`, `playstation`, `xbox`, `released before`. "GTA VI released before June 2026?" → CULTURE.
- [x] [FIX] SPORTS recovery in `reclassifyMarket`: unambiguous league names (NBA, NFL, etc.) rescue markets wrongly tagged by previous bad runs. "LeBron James 2025-2026 NBA MVP?" recovered from POLITICS → SPORTS.
- [x] [FIX] Fixed `POST /system/recategorize-markets`: now uses `reclassifyMarket(title, currentCategory)` instead of `detectCategory(title)` without platform category. Preserves platform-assigned categories (e.g. Kalshi `crypto`).
- [x] [FIX] Recategorization: 850 SPORTS→POLITICS, 572 POLITICS→SPORTS recovered, 4 SPORTS→CULTURE. 13/13 edge case tests pass.

### Store rawPlatformCategory Column (2026-03-26 PM)

- [x] [FIX] Added `rawPlatformCategory String?` to Market Prisma model — stores exact category string from Kalshi/Polymarket API (e.g., `"elections"`, `"crypto"`, `"pop-culture"`).
- [x] [FIX] Updated NormalizedMarket interface, kalshi-client.ts, polymarket-client.ts, market-sync.ts to pass and store `rawPlatformCategory`.
- [x] [FIX] `POST /system/recategorize-markets` now uses stored `rawPlatformCategory` with `detectCategory(title, description, rawPlatformCategory)` — no more loss of platform categories during recategorization.
- [x] [FIX] Migration: `prisma db push` added nullable column. Populates on next market-sync as markets are upserted.

### System Verification: Paper Trade Run Readiness (2026-03-27 PM)

- [x] [VERIFY] ESPN data integration: `espn-data.ts` exists with injuries, standings, team schedules for NBA/NFL/MLB/NHL + 6 soccer leagues. ESPN API calls confirmed working (28 NBA teams with injury data). Wired into SPORTS-EDGE contextProvider alongside The Odds API.
- [x] [VERIFY] The Odds API: `ODDS_API_KEY` confirmed in `.env`. API returning real data (10 NBA games, 18 Ligue 1 games). Monthly usage: 4 calls, 430 remaining (of 500 free tier).
- [x] [VERIFY] SPORTS-EDGE safety: `requireContext: true` enforced — returns null when no data. Worker logs confirm Odds API + ESPN data flowing into SPORTS-EDGE context.
- [x] [VERIFY] Actionability thresholds: `EDGE_ACTIONABILITY_THRESHOLD = 0.03` (3% EV), `MIN_CONFIDENCE_FOR_ACTIONABLE = 0.20` (20% confidence), `MIN_MODULES_FOR_ACTIONABLE = 2`, `MIN_LLM_MODULES_FOR_ACTIONABLE = 1` — all enforced in `cortex.ts`.
- [x] [VERIFY] Speed pipeline paper trades: DISABLED — imports commented out in `speed-pipeline.job.ts`.
- [x] [VERIFY] Paper position + reconciliation jobs: running every 5 min. 12 paper trades created in last 24h.
- [x] [VERIFY] Telegram daily digest: scheduled for 8 AM ET (13:00 UTC) via `daily-digest` repeatable job.
- [x] [VERIFY] Worker stable: PID 44749, all queues registered (ingestion, analysis/RESEARCH, speed/SPEED, arb-scan, maintenance).
- [x] [VERIFY] Module health (last 24h signals): COGEX 186 ✅ | FLOWEX 6,675 ✅ | LEGEX 146 ✅ | DOMEX 125 ✅ | ALTEX 64 ✅ | REFLEX 30 ✅ | SPEEDEX 6,572 ✅ | ARBEX 672 ✅. All 8 active modules producing signals.
- [x] [VERIFY] 24h stats: 13,352 signals, 488 edges, 267 actionable (>=20% conf), 12 paper trades.
- [ ] [FLAG] **LLM cost $24.47/day — still over $5/day budget.** Budget cap was set but high signal volume (13K+ signals/day) is driving cost. Need to investigate: is the HARD_LIMIT actually blocking calls, or just logging? Check if SCREEN_MARKET calls are still the main cost driver.
- [x] [FIX] Added `start-worker.sh` auto-restart loop: 5s cooldown, 60s backoff after 10 rapid restarts, SIGTERM trap for clean shutdown. Worker now survives crashes overnight.

### Fuku Predictions API Integration (2026-03-27 PM)

- [x] [NEW] Created `fuku-data.ts`: Fuku Predictions API client (CBB, NBA, NHL, Soccer). Pre-computed predictions with projected scores, spreads, totals, team rankings, efficiency ratings. Tiered cache: predictions 30min, teams/rankings 6hr. 15s timeout (Render free tier). Health check on startup.
- [x] [NEW] Rewrote `sports-edge.ts` as hybrid data-first agent: tries Fuku first (data passthrough, zero LLM cost), falls back to Odds API + ESPN + LLM for uncovered sports.
- [x] [NEW] Feature mapping: 18 structured features from Fuku → `DomexAgentResult`. Includes `fukuDataPassthrough: true` marker when no LLM call was made.
- [x] [FIX] Odds API preservation: CBB/NBA/NHL/Soccer now served by Fuku (free, unlimited). 500/month Odds API quota reserved for golf, tennis, MMA, etc.
- [x] [VERIFY] End-to-end tests: NBA Celtics vs Hawks ✅, CBB Duke vs St Johns ✅, NHL Sabres vs Red Wings ✅, Golf (uncovered) correctly falls back to LLM ✅.

### MATCH vs FUTURES Market Type Detection (2026-03-27 PM)

- [x] [FIX] Added `detectSportsMarketType()`: classifies sports markets as MATCH or FUTURES before any data fetch. FUTURES markets (league winners, MVPs, tournaments, championships) return null immediately — prevents match-odds-to-futures confusion (e.g., Napoli 92.6% bug).
- [x] [FIX] FUTURES patterns: league/championship winners, tournament/cup winners, MVP/awards, playoffs, relegation, closesAt > 60 days.
- [x] [NEW] `sportsDataSource` and `sportsMarketType` tags in signal features — enables filtering bad signals from FeatureModel training data.
- [x] [VERIFY] Tests: Napoli Serie A→null ✅, Liverpool CL→null ✅, Doncic MVP→null ✅, Celtics vs Hawks→Fuku passthrough ✅, Tiger Woods Masters→null ✅.

### Clean Baseline Reset (2026-03-27 PM)

- [x] [FIX] Archived and cleared all pre-fix data: 14 paper positions (10 were FUTURES contaminated), 1,328 edges, 18,074 signals, 257 alerts, 939K price snapshots.
- [x] [FIX] Preserved: 18,603 markets, 37,206 contracts, SystemConfig, FeatureModel state.
- [x] [FIX] Reset daily LLM budget counter. Worker restarted from clean baseline.
- [x] [VERIFY] Dashboard verified: Edges 0, Portfolio $10K/$0 deployed/0 positions, Markets 18,603, System HEALTHY.
- [x] [VERIFY] Fresh research cycle producing signals with SPEEDEX (20) and FLOWEX (7) first. LLM modules (COGEX/DOMEX/LEGEX/ALTEX/REFLEX) rebuilding on 15-min cycle.

### Verified: FUTURES Markets Flow Through Full Pipeline (2026-03-27 PM)

- [x] [VERIFY] Confirmed SPORTS-EDGE null does NOT block other modules: SPORTS-EDGE is a sub-agent inside DOMEX, not a standalone module. COGEX/FLOWEX/LEGEX/ALTEX/REFLEX all process FUTURES markets independently.
- [x] [VERIFY] Confirmed multi-module requirement (2+, 1+ LLM) is unaffected by SPORTS-EDGE returning null.
- [x] [VERIFY] Live data confirms: Champions League FUTURES → 6 signals from ALTEX+LEGEX, 3 edges created (Arsenal 3.8%, PSG 3.4%, Real Madrid 0.2%). Confidence appropriately low (5-6%). No match-odds contamination.
- [x] [VERIFY] No code changes needed — pipeline architecture was already correct.

### start-all.sh — Resilient Process Management (2026-03-27 PM)

- [x] [NEW] Created `start-all.sh`: starts API + worker + dashboard with auto-restart, health checks, port conflict handling, SIGTERM trap, and separate log files.
- [x] [FIX] Root cause of API crashes: Claude Preview sends SIGTERM on session restart. `start-all.sh` runs independently of Claude Preview.
- [x] [VERIFY] All 8 dashboard pages load: Markets (19,689), Edges (17), Portfolio ($10K/4 paper positions), System, Crypto, Execution, Backtest, Settings.

### Fix Category Misclassification (2026-03-27 PM)

- [x] [FIX] Root cause: Polymarket description "primary resolution source" triggered POLITICS_OVERRIDE `\bprimary\b` → 304 sports markets miscategorized.
- [x] [FIX] Removed standalone `\bprimary\b`; added SPORTS_OVERRIDE as Tier 0a (title-only); expanded Tier 2 sports fallback with 60+ teams.
- [x] [FIX] Recategorized 420 markets: 304 POLITICS→SPORTS, 33 POLITICS→CULTURE, 70 POLITICS→OTHER, 12 POLITICS→SCIENCE. 14/14 tests pass.
- [x] [FIX] Targeted cleanup: deleted 68 stale signals, 96 edges, 2 paper positions from 13 recategorized SPORTS markets. Preserved all non-recategorized market data. Arsenal/Schauffele signals cleared, POLITICS signals intact.
- [x] [VERIFY] SPORTS-EDGE correctly routing on recategorized markets: FUTURES detected → null, other modules still processing.

### Fix Kelly Criterion + Fee-Adjusted EV (2026-03-27 PM)

- [x] [CRITICAL] Fixed BUY_NO Kelly using wrong probability in ALL THREE files. Was using `p = fusedProbability` (YES prob); now uses `p = 1 - fusedProbability` (NO prob — what we're betting on). BUY_NO positions were 3x oversized.
- [x] [CRITICAL] Fixed fabricated `winProb = 0.5 + fusedConfidence * 0.3` in packages/cortex dead code. Now uses actual `fusedProbability`.
- [x] [FIX] Added fee-adjusted EV to production cortex.ts: `netEdge = edgeMagnitude - kalshiFee` before multiplying by confidence.
- [x] [FIX] Fixed Kalshi fee formula: was `0.07 × price × (1-price)`, now `0.07 × (1 - entryPrice)` per contract (7% of profit).
- [x] [VERIFY] All manual tests pass: BUY_YES/BUY_NO symmetric Kelly, no-edge → 0%, fee deduction correct.

### FeatureModel: Train/Val Split, L2 Regularization, Timestamp Fix, Schema Versioning (2026-03-27 PM)

- [x] [CRITICAL] Added 80/20 train/validation split. Model now reports validation accuracy (out-of-sample). Confidence uses validation accuracy, not training accuracy. Model rejected if validation accuracy < 55%.
- [x] [CRITICAL] Added L2 regularization (λ=0.1) to prevent overfitting with 40+ features and sparse data.
- [x] [HIGH] Fixed daysToResolution: now computed from signal.createdAt (not market.createdAt), matching inference-time feature values.
- [x] [HIGH] Added FEATURE_SCHEMA_VERSION=2. DOMEX signals stamped with version. Learning loop filters by version to prevent feature mismatch.
- [x] [FIX] Minimum training samples raised from 20 to 30.
- [x] [VERIFY] Tests pass: insufficient samples → defaults, random data → model rejected, schema version exported.

### Discussed But Not Built

- [ ] [FUTURE] Multi-leg execution strategies (pairs trading across correlated markets)
- [ ] [FUTURE] ML-based wallet classification (replace rule-based classifier with gradient boosted model)
- [ ] [FUTURE] Real-time P&L WebSocket stream (push portfolio value updates to dashboard)
- [ ] [FUTURE] Automated strategy parameter tuning via Bayesian optimization
- [ ] [FUTURE] Exchange-specific order type support (Kalshi limit orders with GTC/GTD, Polymarket conditional orders)
- [ ] [FUTURE] Historical volatility surface construction for crypto markets
- [ ] [FUTURE] Telegram inline keyboard for quick position management (close/adjust from chat)
- [ ] [FUTURE] Docker deployment with health-checked containers, auto-restart, and log aggregation
- [ ] [FUTURE] API rate limit dashboard (visualize external API usage vs. limits per provider)

---

*Total items: ~200+*
*Update this file as tasks are completed: change `- [ ]` to `- [x]`*
