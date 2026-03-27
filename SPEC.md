# APEX — Technical Specification

**Derived from:** PRD.md v1.0
**Date:** 2026-03-26
**Status:** Implementation Reference

---

## Table of Contents

- [Phase 1: Foundation & MVP](#phase-1-foundation--mvp)
- [Phase 2: LLM Modules & Portfolio](#phase-2-llm-modules--portfolio)
- [Phase 3: On-Chain Intelligence & Causal Graph](#phase-3-on-chain-intelligence--causal-graph)
- [Phase 4: Advanced Modules & Backtesting](#phase-4-advanced-modules--backtesting)
- [Phase 5: Optimization & Hardening](#phase-5-optimization--hardening)
- [Phase 6: Platform Expansion & Automation](#phase-6-platform-expansion--automation)
- [A10. TRADEX — Automated Execution Engine](#a10-tradex--automated-execution-engine-phase-1--phase-2--phase-3--phase-5)

---

## Phase 1: Foundation & MVP

### 1.1 Directory Structure

```
apex/
├── turbo.json
├── package.json                          # root workspace config
├── docker-compose.yml                    # Postgres + Redis
├── .env.example
├── .gitignore
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                  # Fastify server entry
│   │   │   ├── config.ts                 # env vars, constants, thresholds
│   │   │   ├── server.ts                 # Fastify instance creation + plugin registration
│   │   │   ├── plugins/
│   │   │   │   ├── auth.ts               # X-API-Key middleware
│   │   │   │   ├── cors.ts
│   │   │   │   └── websocket.ts          # @fastify/websocket setup
│   │   │   ├── routes/
│   │   │   │   ├── markets.ts            # GET /markets, /markets/:id, /markets/:id/prices, /markets/:id/orderbook
│   │   │   │   ├── edges.ts              # GET /edges
│   │   │   │   └── system.ts             # GET /system/health, /system/jobs
│   │   │   ├── services/
│   │   │   │   ├── market-sync.ts        # Kalshi + Polymarket ingestion → unified schema
│   │   │   │   ├── orderbook-sync.ts     # order book snapshot ingestion
│   │   │   │   ├── kalshi-client.ts      # Kalshi API wrapper with HMAC auth
│   │   │   │   ├── polymarket-client.ts  # Polymarket CLOB + Gamma API wrapper
│   │   │   │   └── api-usage-logger.ts   # logs all external API calls to ApiUsageLog
│   │   │   ├── modules/
│   │   │   │   ├── base.ts               # SignalModule abstract class
│   │   │   │   ├── cogex.ts              # COGEX implementation
│   │   │   │   └── flowex.ts             # FLOWEX implementation
│   │   │   ├── engine/
│   │   │   │   ├── cortex.ts             # CORTEX v1 synthesis
│   │   │   │   └── edge-calculator.ts    # edge detection from CORTEX output
│   │   │   ├── jobs/
│   │   │   │   ├── queue.ts              # BullMQ queue + worker setup
│   │   │   │   ├── market-sync.job.ts    # market-sync job handler
│   │   │   │   ├── orderbook-sync.job.ts # orderbook-sync job handler
│   │   │   │   └── signal-pipeline.job.ts# signal pipeline orchestrator
│   │   │   └── lib/
│   │   │       ├── logger.ts             # pino logger setup
│   │   │       ├── prisma.ts             # PrismaClient singleton
│   │   │       └── redis.ts              # Redis/IORedis connection
│   │   └── test/
│   │       ├── modules/
│   │       │   ├── cogex.test.ts
│   │       │   └── flowex.test.ts
│   │       ├── services/
│   │       │   ├── market-sync.test.ts
│   │       │   └── kalshi-client.test.ts
│   │       └── engine/
│   │           └── cortex.test.ts
│   └── dashboard/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── theme.ts                  # dark theme colors, typography
│       │   ├── api/
│       │   │   └── client.ts             # fetch wrapper with API key
│       │   ├── stores/
│       │   │   └── market-store.ts       # Zustand store for markets
│       │   ├── components/
│       │   │   ├── Layout.tsx            # sidebar + main content
│       │   │   ├── Sidebar.tsx           # navigation
│       │   │   ├── DataTable.tsx         # generic sortable/filterable table
│       │   │   └── StatusBadge.tsx       # colored status indicator
│       │   └── pages/
│       │       ├── Markets.tsx           # Market Explorer
│       │       ├── Edges.tsx             # Edge Ranking
│       │       └── System.tsx            # System Monitor (basic)
│       └── public/
│           └── fonts/                    # JetBrains Mono, Inter
├── packages/
│   ├── db/
│   │   ├── package.json
│   │   ├── prisma/
│   │   │   └── schema.prisma            # Phase 1 schema
│   │   └── src/
│   │       └── index.ts                  # re-exports PrismaClient + generated types
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── types.ts                  # SignalOutput, EdgeOutput, etc.
│   │       ├── constants.ts              # module IDs, categories, thresholds
│   │       └── utils.ts                  # shared utilities
│   └── tradex/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                  # re-exports ExecutionManager, executors, types
│           ├── types.ts                  # ExecutionMode, PreflightResult, OrderRequest, OrderResult
│           ├── manager.ts                # ExecutionManager: routing, preflight, circuit breaker
│           ├── preflight.ts              # 7-gate preflight check implementation
│           ├── risk-limits.ts            # Risk limit config with hard ceilings
│           └── executors/
│               ├── base.ts              # BaseExecutor abstract class
│               ├── kalshi.ts            # KalshiExecutor: REST + HMAC, demo/prod
│               └── polymarket.ts        # PolymarketExecutor: CLOB + EIP-712
```

### 1.2 Prisma Schema (Phase 1)

Phase 1 tables: `Market`, `Contract`, `PriceSnapshot`, `OrderBookSnapshot`, `Signal`, `Edge`, `SystemConfig`, `ApiUsageLog`, `ExecutionLog`, `ArbExecution`, `AuditLog`.

Enums: `Platform`, `MarketStatus`, `MarketCategory`, `Resolution`, `EdgeDirection`, `ExecutionStatus`, `ExecutionMode`, `ArbStatus`.

Full schema per PRD section 5.2, excluding Phase 2+ models (`Position`, `PortfolioSnapshot`, `Wallet`, `WalletPosition`, `CausalEdge`, `Alert`, `ModuleScore`, `ModuleWeight` and enums `WalletClassification`, `AlertType`, `AlertSeverity`, `CausalRelationType`).

### 1.3 API Endpoints (Phase 1)

#### `GET /api/v1/markets`

```typescript
// Request query
interface ListMarketsQuery {
  status?: 'ACTIVE' | 'CLOSED' | 'RESOLVED' | 'SUSPENDED';
  category?: MarketCategory;
  platform?: 'KALSHI' | 'POLYMARKET';
  search?: string;         // full-text on title
  page?: number;           // default 1
  limit?: number;          // default 50, max 200
  sort?: 'volume' | 'liquidity' | 'closesAt' | 'createdAt';
  direction?: 'asc' | 'desc'; // default 'desc'
}

// Response
interface ListMarketsResponse {
  data: MarketSummary[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface MarketSummary {
  id: string;
  platform: Platform;
  title: string;
  category: MarketCategory;
  status: MarketStatus;
  yesPrice: number | null;   // latest contract YES price
  noPrice: number | null;
  volume: number;
  liquidity: number;
  closesAt: string | null;
  hasEdge: boolean;
  edgeMagnitude: number | null;
}
```

#### `GET /api/v1/markets/:id`

```typescript
interface MarketDetailResponse {
  id: string;
  platform: Platform;
  platformMarketId: string;
  title: string;
  description: string | null;
  category: MarketCategory;
  status: MarketStatus;
  resolutionText: string | null;
  resolutionSource: string | null;
  resolutionDate: string | null;
  resolution: Resolution | null;
  volume: number;
  liquidity: number;
  closesAt: string | null;
  createdAt: string;
  contracts: ContractDetail[];
  latestEdge: EdgeOutput | null;
}

interface ContractDetail {
  id: string;
  outcome: string;
  lastPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  volume: number;
}
```

#### `GET /api/v1/markets/:id/prices`

```typescript
interface PriceHistoryQuery {
  from?: string;   // ISO date
  to?: string;     // ISO date
  interval?: '5m' | '15m' | '1h' | '4h' | '1d';  // default '1h'
}

interface PriceHistoryResponse {
  marketId: string;
  points: { timestamp: string; yesPrice: number; volume: number }[];
}
```

#### `GET /api/v1/markets/:id/orderbook`

```typescript
interface OrderBookResponse {
  marketId: string;
  contracts: {
    outcome: string;
    bids: { price: number; quantity: number }[];
    asks: { price: number; quantity: number }[];
    spread: number;
    midPrice: number;
    totalBidDepth: number;
    totalAskDepth: number;
    timestamp: string;
  }[];
}
```

#### `GET /api/v1/edges`

```typescript
interface ListEdgesQuery {
  minExpectedValue?: number;  // default 0.03
  minConfidence?: number;
  category?: MarketCategory;
  platform?: Platform;
  sort?: 'expectedValue' | 'edgeMagnitude' | 'confidence' | 'createdAt';
  direction?: 'asc' | 'desc';
  limit?: number;  // default 20
}

interface ListEdgesResponse {
  data: EdgeOutput[];
}
```

#### `GET /api/v1/system/health`

```typescript
interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    postgres: { status: 'up' | 'down'; latencyMs: number };
    redis: { status: 'up' | 'down'; latencyMs: number };
    kalshi: { status: 'up' | 'down' | 'unknown'; lastSuccessAt: string | null };
    polymarket: { status: 'up' | 'down' | 'unknown'; lastSuccessAt: string | null };
  };
  uptime: number;
}
```

#### `GET /api/v1/system/jobs`

```typescript
interface JobStatusResponse {
  queues: {
    name: string;
    active: number;
    waiting: number;
    completed: number;
    failed: number;
    delayed: number;
  }[];
}
```

### 1.4 Key Implementation Details

#### Market Sync Service (`apps/api/src/services/market-sync.ts`)

**Kalshi ingestion:**
1. Call `GET /trade-api/v2/markets` with pagination (cursor-based, 200 per page).
2. Filter to `status: open` markets.
3. Map Kalshi fields → unified `Market` schema:
   - `ticker` → `platformMarketId`
   - `event_ticker` used for category detection
   - `yes_bid` / `yes_ask` → `Contract` with outcome "YES"
   - `no_bid` / `no_ask` → `Contract` with outcome "NO"
   - `rules_primary` → `resolutionText`
   - `close_time` → `closesAt`
   - `volume` → `volume`
4. Upsert via `prisma.market.upsert()` on `@@unique([platform, platformMarketId])`.

**Polymarket ingestion:**
1. Call Gamma API `GET /markets` with `active=true`, paginated (limit 100).
2. For each market, call CLOB API `GET /book` for price data.
3. Map Polymarket fields → unified schema:
   - `condition_id` → `platformMarketId`
   - `question` → `title`
   - `description` → `description`
   - `outcomes` → `Contract` records (YES/NO or named outcomes)
   - `tokens[].price` → contract prices
   - `end_date_iso` → `closesAt`
   - `volume` → `volume`
4. Upsert same as Kalshi.

**Category detection:** Keyword-based classification from title + description. Map to `MarketCategory` enum. Fallback: `OTHER`.

```typescript
function detectCategory(title: string, description: string): MarketCategory {
  const text = `${title} ${description}`.toLowerCase();
  if (/\b(election|president|senate|congress|governor|democrat|republican|biden|trump|vote|poll)\b/.test(text)) return 'POLITICS';
  if (/\b(fed|fomc|rate|inflation|gdp|unemployment|treasury|nasdaq|s&p|stock|recession)\b/.test(text)) return 'FINANCE';
  if (/\b(bitcoin|btc|ethereum|eth|crypto|defi|blockchain|token|nft|solana)\b/.test(text)) return 'CRYPTO';
  if (/\b(climate|temperature|hurricane|earthquake|space|nasa|vaccine|virus|study)\b/.test(text)) return 'SCIENCE';
  if (/\b(nfl|nba|mlb|nhl|world cup|super bowl|championship|game|match|score)\b/.test(text)) return 'SPORTS';
  if (/\b(oscar|grammy|emmy|box office|movie|album|celebrity|tiktok)\b/.test(text)) return 'CULTURE';
  return 'OTHER';
}
```

#### Kalshi Client (`apps/api/src/services/kalshi-client.ts`)

HMAC authentication per Kalshi API docs:
```typescript
import crypto from 'node:crypto';

function signRequest(method: string, path: string, timestamp: string, body: string = ''): string {
  const message = `${timestamp}${method}${path}${body}`;
  return crypto.createHmac('sha256', KALSHI_API_SECRET)
    .update(message)
    .digest('base64');
}
```

Rate limiting: Token bucket, 10 req/s. Use `bottleneck` library.

#### Polymarket Client (`apps/api/src/services/polymarket-client.ts`)

Two sub-clients:
- **Gamma client**: Public API, no auth. Rate limit: 60 req/min via `bottleneck`.
- **CLOB client**: API key header `Authorization: Bearer {key}`. Rate limit: 100 req/min.

#### COGEX Module (`apps/api/src/modules/cogex.ts`)

```typescript
interface CogexMetadata {
  anchoringScore: number;      // 0-1, strength of anchoring bias detected
  tailRiskScore: number;       // 0-1, degree of tail underpricing
  recencyScore: number;        // 0-1, degree of recency bias
  favLongshotScore: number;    // 0-1, degree of fav-longshot bias
  adjustments: {
    anchoring: number;         // probability adjustment (-0.15 to +0.15)
    tailRisk: number;
    recency: number;
    favLongshot: number;
  };
}
```

**Anchoring detector algorithm:**
1. Define anchors: `[0.10, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60, 0.70, 0.75, 0.80, 0.90]`.
2. For each anchor, compute time the price was within `anchor ± 0.02` over last 7 days.
3. Under random walk null model, expected time near any anchor ≈ 4% (0.04 width / 1.0 range).
4. Stickiness ratio = actual_time / expected_time. If > 2.0, anchoring detected.
5. Adjustment: push probability away from nearest anchor by `0.02 * (stickiness_ratio - 1)`, capped at ±0.10.

**Tail risk detector:**
1. Query resolved markets in same category.
2. Compute empirical tail frequencies: how often do events priced < 0.10 resolve YES? > 0.90?
3. If empirical rate > implied rate, adjust toward fatter tails.
4. E.g., if markets priced at 0.05 historically resolve YES 12% of the time, adjust from 0.05 → 0.08.

**Recency bias detector:**
1. Compute price volatility in 7-day vs 90-day windows.
2. If 7-day vol > 2× 90-day vol and price has moved > 5% in 7 days, flag recency bias.
3. Adjustment: dampen the 7-day move by 30%. E.g., if price moved from 0.50 → 0.65 in 7 days, adjustment pushes toward 0.50 + 0.70 × 0.15 = 0.605.

**Favorite-longshot detector:**
1. Bin resolved markets by price at T-30 days before resolution.
2. Compute calibration: actual_resolution_rate per bin.
3. If bin 0.70-0.80 actually resolves at 0.65, then current markets at 0.75 get adjusted to ~0.69.
4. Requires 30+ resolved markets per bin for statistical significance; otherwise, no adjustment.

**Combined output:**
```
biasAdjustedProbability = marketPrice + weightedAvg(adjustments)
confidence = min(0.8, dataQuality * biasDetectionStrength)
```
Where `dataQuality` = function of price history length and resolved market count. `biasDetectionStrength` = max absolute adjustment / 0.10.

#### FLOWEX Module (`apps/api/src/modules/flowex.ts`)

```typescript
interface FlowexMetadata {
  orderFlowImbalance: number;        // -1 to +1 (negative = sell pressure)
  moveClassification: 'LIQUIDITY' | 'INFORMATION' | 'UNKNOWN';
  vwap24h: number;
  priceVsVwap: number;              // current - vwap
  meanReversionSignal: boolean;
  thinBookFlag: boolean;
  bidDepthTotal: number;
  askDepthTotal: number;
}
```

**Order Flow Imbalance:**
1. Compare current order book to previous snapshot (5 min ago).
2. OFI = sum of (bid_increase - bid_decrease) - sum of (ask_increase - ask_decrease) across top 5 price levels.
3. Normalize to [-1, +1] by dividing by total book depth.

**Move classification:**
1. If price moved > 2% in last snapshot interval AND book depth decreased > 20%: `INFORMATION`.
2. If price moved > 2% but book depth stable or increased: `LIQUIDITY`.
3. Otherwise: `UNKNOWN`.

**Mean reversion signal:**
- Triggered when `moveClassification === 'LIQUIDITY'` AND `|priceVsVwap| > 0.03`.
- FLOWEX probability = VWAP (i.e., mean reversion target).
- Confidence = `min(0.6, bookDepth / 50000)` — higher book depth = more confident in mean reversion.

#### CORTEX v3 (`apps/api/src/engine/cortex.ts`)

The live synthesis engine. Pipeline: **Calibration → Signal Fusion → Edge Calculation → Kelly Sizing**.

Delegates probability fusion to the canonical `fuseSignals()` engine in `@apex/cortex`, which handles time decay, module weighting, and agreement scoring. The live engine adds:

1. **Calibration stage**: calls `applyCalibration()` from `@apex/cortex` on each raw signal probability before fusion. Applies per-module, per-category, per-time-bucket bias corrections learned from resolved markets.
2. **Signal filtering**: ARBEX and SPEEDEX excluded from probability synthesis (they produce arb signals, not probability estimates).
3. **Conflict detection**: Low agreement score (< 0.5) from fusion engine triggers conflict flag.
4. **Kelly sizing**: Quarter-Kelly formula: `f* = max(0, ((p*b - q) / b) * 0.25)` where `p = cortexProbability`, `q = 1-p`, `b = 1/betPrice - 1`.
5. **Minimum module requirement**: An edge is only `isActionable` if ALL three conditions are met:
   - EV exceeds `EDGE_ACTIONABILITY_THRESHOLD` (3%)
   - At least 2 modules contributed probability signals
   - At least 1 LLM module (LEGEX, DOMEX, ALTEX, or REFLEX) contributed — pure statistical signals (COGEX, FLOWEX) alone detect patterns but cannot analyze the actual event
6. **Actionability summary**: Every edge includes a human-readable `actionabilitySummary` string explaining the CORTEX estimate, direction, contributing modules, and why the edge is/isn't actionable.

```typescript
interface CortexInput {
  marketId: string;
  marketPrice: number;
  marketCategory: string;
  signals: SignalOutput[];
  closesAt?: Date | null;
}
```

#### BullMQ Job Setup (`apps/api/src/jobs/queue.ts`)

```typescript
import { Queue, Worker, QueueScheduler } from 'bullmq';
import { redis } from '../lib/redis';

// Queues
export const ingestionQueue = new Queue('ingestion', { connection: redis });
export const analysisQueue = new Queue('analysis', { connection: redis });

// Repeatable jobs
await ingestionQueue.add('market-sync', {}, {
  repeat: { every: 5 * 60 * 1000 },  // 5 min
  jobId: 'market-sync-repeatable',
});

await ingestionQueue.add('orderbook-sync', {}, {
  repeat: { every: 5 * 60 * 1000, offset: 60 * 1000 },  // 5 min, offset 1 min
  jobId: 'orderbook-sync-repeatable',
});

await analysisQueue.add('signal-pipeline', {}, {
  repeat: { every: 15 * 60 * 1000 },  // 15 min
  jobId: 'signal-pipeline-repeatable',
});
```

#### Dashboard — Component Hierarchy

**Layout:**
```
App
├── Layout
│   ├── Sidebar (nav links, active state, keyboard shortcut hints)
│   └── MainContent
│       └── <Router>
│           ├── Markets (Market Explorer)
│           ├── Edges (Edge Ranking)
│           └── System (System Monitor)
```

**Markets page:**
```
Markets
├── PageHeader (title, market count)
├── FilterBar
│   ├── PlatformFilter (dropdown: All/Kalshi/Polymarket)
│   ├── CategoryFilter (dropdown: All/Politics/Finance/...)
│   ├── StatusFilter (dropdown: All/Active/Closed/Resolved)
│   └── SearchInput (debounced text search)
├── DataTable
│   ├── SortableHeader (click to sort)
│   └── MarketRow[] (clickable → navigates to /markets/:id)
└── Pagination
```

**Edges page:**
```
Edges
├── PageHeader (title, actionable count)
├── FilterBar
│   ├── MinEVSlider
│   ├── CategoryFilter
│   └── PlatformFilter
└── DataTable
    ├── SortableHeader
    └── EdgeRow[] (colored by EV magnitude, clickable → signal view)
```

**System page:**
```
System
├── HealthCards (Postgres, Redis, Kalshi, Polymarket — green/red)
├── JobQueueTable (queue name, active/waiting/failed counts)
└── RecentErrorsList (last 20 errors from pino logs)
```

**State management (Zustand):**
```typescript
// stores/market-store.ts
interface MarketStore {
  markets: MarketSummary[];
  loading: boolean;
  filters: ListMarketsQuery;
  pagination: { page: number; limit: number; total: number };
  fetchMarkets: () => Promise<void>;
  setFilters: (filters: Partial<ListMarketsQuery>) => void;
  setPage: (page: number) => void;
}
```

**API client:**
```typescript
// api/client.ts
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
const API_KEY = import.meta.env.VITE_API_KEY;

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  listMarkets: (query: ListMarketsQuery) => apiFetch<ListMarketsResponse>(`/markets?${qs(query)}`),
  getMarket: (id: string) => apiFetch<MarketDetailResponse>(`/markets/${id}`),
  getPriceHistory: (id: string, query: PriceHistoryQuery) => apiFetch<PriceHistoryResponse>(`/markets/${id}/prices?${qs(query)}`),
  getOrderBook: (id: string) => apiFetch<OrderBookResponse>(`/markets/${id}/orderbook`),
  listEdges: (query: ListEdgesQuery) => apiFetch<ListEdgesResponse>(`/edges?${qs(query)}`),
  getHealth: () => apiFetch<HealthResponse>('/system/health'),
  getJobs: () => apiFetch<JobStatusResponse>('/system/jobs'),
};
```

### 1.5 NPM Dependencies

#### Root / Workspace

| Package | Version | Purpose |
|---------|---------|---------|
| `turbo` | `^2.3.0` | Monorepo build orchestration |
| `typescript` | `^5.7.0` | Language |

#### `apps/api`

| Package | Version | Purpose |
|---------|---------|---------|
| `fastify` | `^5.2.0` | HTTP framework |
| `@fastify/cors` | `^10.0.0` | CORS plugin |
| `@fastify/websocket` | `^11.0.0` | WebSocket support |
| `bullmq` | `^5.30.0` | Job queue |
| `ioredis` | `^5.4.0` | Redis client |
| `pino` | `^9.6.0` | Structured logging |
| `pino-pretty` | `^13.0.0` | Dev log formatting |
| `bottleneck` | `^2.19.5` | Rate limiting for external APIs |
| `axios` | `^1.7.0` | HTTP client for external APIs |
| `zod` | `^3.24.0` | Request/response validation |
| `dotenv` | `^16.4.0` | Env vars |
| `vitest` | `^3.0.0` | Testing |

#### `apps/dashboard`

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | `^19.0.0` | UI framework |
| `react-dom` | `^19.0.0` | DOM rendering |
| `react-router-dom` | `^7.1.0` | Routing |
| `zustand` | `^5.0.0` | State management |
| `recharts` | `^2.15.0` | Charts |
| `@tanstack/react-table` | `^8.21.0` | Headless table |
| `vite` | `^6.1.0` | Build tool |

#### `packages/db`

| Package | Version | Purpose |
|---------|---------|---------|
| `prisma` | `^6.3.0` | ORM CLI |
| `@prisma/client` | `^6.3.0` | ORM runtime |

### 1.6 Environment Variables

```bash
# Database
DATABASE_URL=postgresql://apex:apex@localhost:5432/apex

# Redis
REDIS_URL=redis://localhost:6379

# API Auth
API_KEY=your-secret-api-key-here

# Kalshi
KALSHI_API_KEY=
KALSHI_API_SECRET=
KALSHI_BASE_URL=https://trading-api.kalshi.com/trade-api/v2

# Polymarket
POLYMARKET_CLOB_URL=https://clob.polymarket.com
POLYMARKET_GAMMA_URL=https://gamma-api.polymarket.com
POLYMARKET_API_KEY=

# API Server
PORT=3001
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info

# Dashboard
VITE_API_URL=http://localhost:3001/api/v1
VITE_API_KEY=your-secret-api-key-here

# TRADEX — Execution Engine
TRADEX_ENABLED=false                    # Master kill switch
TRADEX_FAST_EXEC_ENABLED=false          # Auto-execution toggle
KALSHI_USE_DEMO=true                    # Start in demo/sandbox mode
POLYMARKET_PRIVATE_KEY=                 # ETH wallet for Polymarket
POLYGON_RPC_URL=https://polygon-rpc.com
```

### 1.7 Docker Compose

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: apex
      POSTGRES_PASSWORD: apex
      POSTGRES_DB: apex
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

### 1.8 Testing Requirements

| Test | Acceptance Criteria |
|------|-------------------|
| COGEX anchoring detector | Given price history clustered at 0.50, outputs stickiness > 2.0 and negative adjustment |
| COGEX tail risk detector | Given historical tail resolution rate of 12% and current price 0.05, adjusts upward |
| COGEX favorite-longshot | Given calibration data showing overpriced favorites, adjusts 0.75 → ~0.70 |
| FLOWEX OFI calculation | Given two order book snapshots, correctly computes signed imbalance |
| FLOWEX mean reversion | Given liquidity-classified move >3% from VWAP, outputs signal toward VWAP |
| CORTEX v1 synthesis | Given 2 signals, produces weighted average with correct confidence and edge calculation |
| Market sync (Kalshi) | Mocked Kalshi API response correctly upserts Market + Contract records |
| Market sync (Polymarket) | Mocked Gamma API response correctly upserts Market + Contract records |
| Health endpoint | Returns 'healthy' when Postgres + Redis connected, 'unhealthy' otherwise |
| API auth middleware | Requests without valid X-API-Key return 401 |

### 1.9 Phase 1 Checkpoints

1. `docker compose up` starts Postgres and Redis, both healthy.
2. `prisma migrate dev` runs successfully, creates all Phase 1 tables.
3. `turbo build` succeeds across all workspaces with no type errors.
4. `GET /api/v1/system/health` returns `{ status: 'healthy' }`.
5. Market sync job runs and populates markets from both Kalshi and Polymarket.
6. COGEX produces signals for markets with sufficient price history.
7. FLOWEX produces signals for markets with order book data.
8. CORTEX synthesizes available signals into edges.
9. `GET /api/v1/edges` returns actionable edges (if any exist).
10. Dashboard loads at `http://localhost:5173`, shows markets in table, edges on edge page.
11. TRADEX package builds, preflight checks pass/fail correctly, KalshiExecutor connects to demo API.
12. Kill switch toggle and risk limit settings page functional on dashboard.
13. All tests pass via `vitest run`.

---

## Phase 2: LLM Modules & Portfolio

### 2.1 New Files

```
apps/api/src/
├── modules/
│   ├── legex.ts              # LEGEX implementation
│   ├── domex.ts              # DOMEX orchestrator
│   ├── domex-agents/
│   │   ├── base-agent.ts     # shared agent runner
│   │   ├── fed-hawk.ts       # Fed/macro agent
│   │   ├── geo-intel.ts      # geopolitics agent
│   │   └── crypto-alpha.ts   # crypto agent
│   └── altex.ts              # ALTEX implementation (English news only)
├── services/
│   ├── claude-client.ts      # Claude API wrapper with token tracking
│   ├── news-client.ts        # NewsAPI wrapper
│   └── portfolio-manager.ts  # Kelly sizing, concentration limits
├── routes/
│   ├── signals.ts            # GET /signals, /signals/modules
│   ├── portfolio.ts          # GET/POST/PATCH /portfolio/*
│   └── alerts.ts             # GET/PATCH /alerts/*
├── jobs/
│   └── news-ingest.job.ts    # news ingestion job
├── engine/
│   └── alert-engine.ts       # alert creation + cooldown logic
└── plugins/
    └── websocket.ts          # updated: edge + alert event broadcasting

apps/api/src/prompts/         # LLM system prompts
├── legex-system.md
├── domex-fed-hawk.md
├── domex-geo-intel.md
├── domex-crypto-alpha.md
└── altex-news.md

apps/dashboard/src/
├── stores/
│   ├── edge-store.ts
│   ├── portfolio-store.ts
│   └── alert-store.ts
├── hooks/
│   └── useWebSocket.ts       # WebSocket connection hook
├── components/
│   ├── AlertPanel.tsx         # notification dropdown
│   ├── SignalCard.tsx         # module signal display
│   ├── ProbabilityGauge.tsx   # circular gauge component
│   ├── ConfidenceBar.tsx      # horizontal confidence bar
│   └── PositionForm.tsx       # add/edit position form
└── pages/
    ├── SignalViewer.tsx       # /markets/:id/signals
    └── Portfolio.tsx          # /portfolio
```

### 2.2 Prisma Schema Changes (Phase 2)

Add models: `Position`, `PortfolioSnapshot`, `Alert`, `ModuleWeight`.
Add enums: `AlertType`, `AlertSeverity`.

### 2.3 New API Endpoints

#### `GET /api/v1/markets/:id/signals`

```typescript
interface MarketSignalsResponse {
  marketId: string;
  signals: SignalOutput[];
  cortex: EdgeOutput | null;
}
```

#### `GET /api/v1/signals/modules`

```typescript
interface ModuleStatusResponse {
  modules: {
    moduleId: string;
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    successRate: number;      // 0-1, last 24 hours
    avgLatencyMs: number;
    status: 'healthy' | 'degraded' | 'down';
  }[];
}
```

#### `POST /api/v1/portfolio/positions`

```typescript
interface CreatePositionRequest {
  marketId: string;
  platform: Platform;
  direction: EdgeDirection;
  entryPrice: number;
  size: number;
  quantity: number;
}

interface CreatePositionResponse {
  id: string;
  // ... full Position fields
}
```

#### `PATCH /api/v1/portfolio/positions/:id`

```typescript
interface UpdatePositionRequest {
  currentPrice?: number;
  exitPrice?: number;
  closedAt?: string;
  isOpen?: boolean;
}
```

#### `GET /api/v1/portfolio/summary`

```typescript
interface PortfolioSummaryResponse {
  totalValue: number;          // bankroll
  deployedCapital: number;
  unrealizedPnl: number;
  realizedPnl: number;
  portfolioHeat: number;
  openPositions: number;
  riskLimits: {
    dailyLoss: { current: number; limit: number; breached: boolean };
    weeklyLoss: { current: number; limit: number; breached: boolean };
    maxDrawdown: { current: number; limit: number; breached: boolean };
  };
  concentrations: {
    byCategory: Record<MarketCategory, number>;
    byPlatform: Record<Platform, number>;
  };
}
```

#### `GET /api/v1/alerts`

```typescript
interface ListAlertsQuery {
  acknowledged?: boolean;
  severity?: AlertSeverity;
  type?: AlertType;
  limit?: number;  // default 50
}

interface ListAlertsResponse {
  data: AlertRecord[];
}
```

### 2.4 LLM System Prompts

#### LEGEX System Prompt (`apps/api/src/prompts/legex-system.md`)

```markdown
You are LEGEX, a legal resolution analyst for prediction markets. Your job is to identify mispricing caused by ambiguous or commonly misunderstood resolution criteria.

## Task
Analyze the resolution criteria for a prediction market and identify:
1. Ambiguities in the resolution language
2. Edge cases not explicitly addressed
3. Differences between what traders likely think the market resolves on vs. what it actually resolves on
4. If cross-platform data is provided, divergences in resolution language between platforms

## Output Format
Respond with valid JSON matching this schema:
{
  "resolutionParsed": {
    "source": "string — who/what determines resolution",
    "trigger": "string — what event triggers resolution",
    "yesCondition": "string — exact condition for YES",
    "noCondition": "string — exact condition for NO",
    "edgeCasesMentioned": ["string"],
    "edgeCasesOmitted": ["string — potential edge cases NOT addressed"]
  },
  "ambiguityScore": number,  // 1-5, 1=crystal clear, 5=highly ambiguous
  "ambiguousTerms": [
    { "term": "string", "interpretations": ["string", "string"], "riskLevel": number }
  ],
  "misinterpretationProbability": number, // 0-1, probability that median trader misreads resolution
  "probabilityAdjustment": number, // -0.20 to +0.20, how resolution risk shifts fair probability
  "adjustmentDirection": "TOWARD_YES | TOWARD_NO | NONE",
  "reasoning": "string — 2-3 sentence explanation",
  "crossPlatformDivergence": {
    "detected": boolean,
    "details": "string | null"
  }
}

## Guidelines
- Be conservative: only flag genuine ambiguity, not theoretical edge cases
- Consider how a reasonable but non-expert trader would interpret the resolution text
- Focus on resolution language that could lead to unexpected YES/NO outcomes
- If resolution source is a specific data provider (e.g., BLS, Fed), consider their methodology quirks
- For UMA-resolved markets (Polymarket), note oracle risk as an additional factor
```

#### DOMEX FED-HAWK Prompt (`apps/api/src/prompts/domex-fed-hawk.md`)

```markdown
You are FED-HAWK, a senior Federal Reserve and monetary policy analyst. You have deep expertise in:
- FOMC decision-making patterns and communication strategies
- Interest rate policy, quantitative tightening, and balance sheet operations
- Inflation dynamics (CPI, PCE, core vs headline)
- Labor market indicators the Fed watches
- Historical precedents for policy shifts
- How Fed Funds futures and Treasury yields reflect market expectations

## Task
Given a prediction market question, estimate the probability of the YES outcome. Think step by step:

1. **Base rate**: What is the historical base rate for this type of event?
2. **Current conditions**: What do current economic indicators suggest?
3. **Fed communication**: What has the Fed signaled recently?
4. **Market pricing**: How do Fed Funds futures price this outcome? Does the prediction market diverge from fixed income markets?
5. **Key uncertainties**: What could change the outcome?

## Output Format
Respond with valid JSON:
{
  "probability": number,      // 0.0-1.0
  "confidence": number,       // 0.0-1.0
  "topFactors": [
    "string — most important factor #1",
    "string — most important factor #2",
    "string — most important factor #3"
  ],
  "keyUncertainties": [
    "string — biggest unknown #1",
    "string — biggest unknown #2"
  ],
  "reasoning": "string — 3-5 sentence analysis"
}

## Calibration Instructions
- Anchor to base rates. Most FOMC meetings result in no change during stable periods.
- If you are uncertain, express it through confidence, not by pushing probability to 0.50.
- Reference class forecasting: what happened in similar historical situations?
- Your probability should be independent of the market price shown to you — do not anchor to it.
- A confidence of 0.3 means you have limited informational advantage; 0.7+ means strong domain-specific insight.
```

#### DOMEX GEO-INTEL Prompt (`apps/api/src/prompts/domex-geo-intel.md`)

```markdown
You are GEO-INTEL, a geopolitical intelligence analyst. Your expertise spans:
- International relations and diplomatic signaling
- Military conflict assessment and escalation dynamics
- Sanctions, trade policy, and economic statecraft
- Elections, regime stability, and political transitions globally
- Intelligence community analytical frameworks (ACH, key assumptions check)

## Task
Given a prediction market question, estimate the probability of the YES outcome using structured geopolitical analysis.

## Analytical Framework
1. **Identify key actors** and their interests/constraints
2. **Assess capabilities vs intentions** — can they do it, and will they?
3. **Historical analogies** — what happened in similar situations?
4. **Signaling analysis** — what are actors communicating through actions/statements?
5. **Red team** — what would change your estimate dramatically?

## Output Format
Respond with valid JSON:
{
  "probability": number,
  "confidence": number,
  "topFactors": ["string", "string", "string"],
  "keyUncertainties": ["string", "string"],
  "reasoning": "string — 3-5 sentence analysis"
}

## Calibration
- Geopolitical events are notoriously hard to predict. Reflect this in your confidence.
- Avoid the narrative fallacy — compelling stories != higher probability.
- Consider multiple scenarios, not just the most salient one.
- Base rates matter: most international crises do NOT escalate to conflict.
```

#### DOMEX CRYPTO-ALPHA Prompt (`apps/api/src/prompts/domex-crypto-alpha.md`)

```markdown
You are CRYPTO-ALPHA, a cryptocurrency and DeFi analyst. Your expertise covers:
- Bitcoin and Ethereum fundamentals, on-chain metrics, and market cycles
- DeFi protocols, governance, and smart contract risk
- Crypto regulatory landscape (SEC, CFTC, global)
- Token economics, supply dynamics, and halving effects
- Correlation between crypto and traditional risk assets

## Task
Given a prediction market question about crypto/DeFi, estimate the probability of the YES outcome.

## Analytical Framework
1. **On-chain fundamentals**: What do metrics like active addresses, TVL, exchange flows suggest?
2. **Market structure**: Where are we in the cycle? What does derivatives positioning show?
3. **Regulatory signals**: Any pending enforcement actions, legislation, or court decisions?
4. **Technical factors**: Protocol upgrades, smart contract risks, governance proposals?
5. **Macro correlation**: How are risk assets behaving? Is crypto following or diverging?

## Output Format
Respond with valid JSON:
{
  "probability": number,
  "confidence": number,
  "topFactors": ["string", "string", "string"],
  "keyUncertainties": ["string", "string"],
  "reasoning": "string — 3-5 sentence analysis"
}

## Calibration
- Crypto markets are highly volatile — reflect uncertainty in confidence.
- Avoid recency bias from the latest pump/dump.
- Regulatory outcomes are binary and hard to predict — keep confidence moderate on regulatory markets.
- Price prediction markets have very low base-rate accuracy for point estimates — express wide uncertainty.
```

#### ALTEX News Prompt (`apps/api/src/prompts/altex-news.md`)

```markdown
You are ALTEX, a news intelligence analyst for prediction markets. You analyze recent news articles to detect information that may not yet be fully priced into prediction markets.

## Task
Given a batch of recent news articles and a list of active prediction markets, identify:
1. Which markets are affected by the news
2. Whether the news shifts probability up or down
3. How much of this information is likely already priced in

## Output Format
Respond with valid JSON:
{
  "marketImpacts": [
    {
      "marketId": "string",
      "relevance": number,         // 0-1
      "probabilityShift": number,  // -0.30 to +0.30
      "direction": "TOWARD_YES | TOWARD_NO",
      "likelyPricedIn": number,    // 0-1, 1 = fully priced in already
      "sourceReliability": number, // 0-1
      "summary": "string — one sentence explaining the impact",
      "keyArticles": ["string — article titles"]
    }
  ],
  "noImpactMarkets": ["string — marketIds with no relevant news"]
}

## Guidelines
- Prioritize breaking news (< 2 hours old) over older articles
- Discount opinion pieces vs. primary source reporting
- Consider whether the news is a surprise (not priced in) or expected (already priced in)
- A 0.05 probability shift from news is significant; 0.15+ is major
- Be skeptical of single-source stories; multiple corroborating sources increase reliability
```

### 2.5 Claude Client (`apps/api/src/services/claude-client.ts`)

```typescript
import Anthropic from '@anthropic-ai/sdk';

interface ClaudeCallOptions {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  moduleId: string;     // for cost tracking
}

interface ClaudeResponse<T> {
  parsed: T;
  usage: { inputTokens: number; outputTokens: number; cost: number };
}

// Cost tracking: log every call to ApiUsageLog
// Rate limiting: bottleneck, max 50 req/min
// Timeout: 60s per call
// Retry: 1 retry on 529/timeout, exponential backoff
```

### 2.6 CORTEX v2 Updates

Add to `apps/api/src/engine/cortex.ts`:
- Dynamic weighting from `ModuleWeight` table (fall back to defaults if no data)
- Time decay: `exp(-lambda * ageMinutes)` per module type
- Conflict detection: flag when module spread > 0.20
- Confidence aggregation with disagreement penalty and coverage factor

### 2.7 Kelly Criterion

Kelly sizing is computed directly in `engine/cortex.ts` during synthesis and stored in the Edge record:

```
f* = (p * b - q) / b           # full Kelly fraction
kellySize = max(0, f* * 0.25)  # quarter-Kelly for safety
```

Where:
- `p` = cortexProbability (CORTEX fair value)
- `q` = 1 - p
- `b` = payoff odds = `(1 / betPrice) - 1`
- `betPrice` = marketPrice for BUY_YES, `1 - marketPrice` for BUY_NO

The `kellySize` field is stored on every Edge record and passed to the PaperTrader for position sizing. Portfolio-level concentration limits (`portfolio-manager.ts`, `portfolio-allocator.ts`) apply on top of Kelly sizing.

### 2.8 WebSocket Events (Phase 2)

```typescript
// Server broadcasts on edge creation/update
ws.send(JSON.stringify({ event: 'edge:new', data: edgeOutput }));
ws.send(JSON.stringify({ event: 'alert:new', data: alertRecord }));

// Client connects with:
// ws://localhost:3001/ws?apiKey=xxx
```

### 2.9 New Dependencies (Phase 2)

| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/sdk` | `^0.39.0` | Claude API client |
| `rss-parser` | `^3.13.0` | RSS feed parsing (for ALTEX) |

### 2.10 New Environment Variables

```bash
ANTHROPIC_API_KEY=
NEWSAPI_KEY=
BANKROLL=10000                     # total deployable capital
KELLY_MULTIPLIER=0.25              # fraction of Kelly to use
LLM_DAILY_BUDGET=5.00              # daily Claude API budget in USD (hard cap)
```

### 2.11 Testing Requirements (Phase 2)

| Test | Acceptance Criteria |
|------|-------------------|
| LEGEX with mock Claude response | Correctly parses structured output, computes adjustment |
| DOMEX aggregation with 3 agents | Trimmed mean computed correctly; confidence reflects disagreement |
| ALTEX news matching | Given test articles and markets, correct relevance matching |
| Claude client retry logic | Simulated 529 → retries once, then fails gracefully |
| Claude client cost tracking | ApiUsageLog entry created with correct token counts |
| Kelly sizing | Given edge=0.10, price=0.50, bankroll=10000, kelly_mult=0.25 → correct size |
| Concentration limits | Position exceeding 5% single-market limit is capped |
| Alert cooldown | Same alert type for same market within cooldown window is suppressed |
| WebSocket event delivery | Client receives `edge:new` event within 500ms of edge creation |
| Portfolio summary endpoint | Returns correct P&L calculation from open positions |

### 2.12 Phase 2 Checkpoints

1. Claude API integration works: LEGEX, DOMEX, ALTEX all produce valid signals.
2. CORTEX v2 synthesizes 5 modules (COGEX, FLOWEX, LEGEX, DOMEX, ALTEX) with dynamic weighting.
3. Portfolio: can create/update/close positions. Kelly sizing returns valid recommendations.
4. Alerts: NEW_EDGE alerts fire when edges detected. MODULE_FAILURE fires on 3 consecutive failures.
5. WebSocket: dashboard receives real-time edge and alert updates.
6. Signal Viewer page shows all module outputs for a market.
7. Portfolio page shows positions, P&L, concentration breakdown.
8. LLM cost tracking: `/system/usage` shows Claude API costs.

---

## Phase 3: On-Chain Intelligence & Causal Graph

### 3.1 New Files

```
apps/api/src/
├── modules/
│   ├── sigint.ts                  # SIGINT orchestrator
│   ├── sigint/
│   │   ├── wallet-indexer.ts      # Polygon event indexing
│   │   ├── wallet-classifier.ts   # classification algorithm
│   │   └── divergence-detector.ts # smart money divergence signal
│   ├── nexus.ts                   # NEXUS orchestrator
│   └── nexus/
│       ├── graph-builder.ts       # LLM + statistical graph construction
│       ├── consistency-checker.ts # joint probability validation
│       └── correlation-matrix.ts  # rolling price correlation
├── services/
│   ├── polygon-client.ts          # Polygon RPC + event parsing
│   └── webhook-sender.ts         # outbound webhook for alerts
├── routes/
│   ├── sigint.ts                  # GET /sigint/*
│   └── nexus.ts                   # GET /nexus/*
├── jobs/
│   ├── wallet-profile.job.ts
│   ├── wallet-monitor.job.ts
│   ├── graph-rebuild.job.ts
│   └── consistency-check.job.ts
└── prompts/
    └── nexus-causal.md            # graph construction prompt

apps/dashboard/src/
├── pages/
│   ├── Sigint.tsx                 # SIGINT Dashboard
│   └── Nexus.tsx                  # NEXUS Graph
├── components/
│   ├── ForceGraph.tsx             # D3 force-directed graph
│   ├── WalletTable.tsx
│   └── SmartMoneyMoves.tsx
└── stores/
    ├── sigint-store.ts
    └── nexus-store.ts
```

### 3.2 Prisma Schema Changes (Phase 3)

Add models: `Wallet`, `WalletPosition`, `CausalEdge`.
Add enums: `WalletClassification`, `CausalRelationType`.

### 3.3 SIGINT Implementation Details

**Polygon event indexing** (`apps/api/src/modules/sigint/wallet-indexer.ts`):
- Listen for ERC-1155 `TransferSingle` and `TransferBatch` events from Polymarket's CTF Exchange contract.
- Contract address: `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` (Polymarket CTF Exchange on Polygon).
- Use `eth_getLogs` with block range queries (batch 2000 blocks per call).
- Track high-water mark block number in `SystemConfig` to avoid re-processing.

**Wallet classifier** features and thresholds:
```typescript
interface WalletFeatures {
  roi: number;              // total P&L / total invested
  winRate: number;          // profitable markets / total resolved markets
  avgPositionSize: number;  // in USD
  marketCount: number;      // total markets traded
  avgHoldDuration: number;  // hours
  categoryEntropy: number;  // Shannon entropy of category distribution
  timingScore: number;      // how early vs. consensus (lower = earlier)
  txFrequency: number;      // transactions per day
  twoSidedRatio: number;    // fraction of markets with positions on both sides
}

// Classification rules (applied in order)
// BOT: txFrequency > 50/day AND avg time between txs < 10s
// MARKET_MAKER: twoSidedRatio > 0.6 AND txFrequency > 10/day
// SMART_MONEY: roi > 0.15 AND marketCount >= 100 AND winRate > 0.55
// WHALE: avgPositionSize > 50000
// RETAIL: default
```

### 3.4 NEXUS Causal Prompt (`apps/api/src/prompts/nexus-causal.md`)

```markdown
You are NEXUS, a causal reasoning analyst. Given a set of prediction market titles and descriptions, identify causal relationships between them.

## Task
Analyze the provided markets and identify pairs where one market's outcome causally influences another's probability.

## Output Format
Respond with valid JSON:
{
  "relationships": [
    {
      "fromMarketId": "string",
      "toMarketId": "string",
      "relationType": "CAUSES | PREVENTS | CORRELATES | CONDITIONAL_ON",
      "strength": number,       // 0-1, how strong the causal link
      "description": "string — one sentence explaining the relationship",
      "directionality": number  // -1 to +1, positive = same direction, negative = inverse
    }
  ]
}

## Guidelines
- Only identify relationships where there is a plausible causal mechanism
- CAUSES: outcome of A directly increases probability of B
- PREVENTS: outcome of A directly decreases probability of B
- CORRELATES: A and B share a common cause but don't directly affect each other
- CONDITIONAL_ON: B's resolution depends on A's outcome
- Strength 0.8+ = strong causal link; 0.3-0.5 = moderate; < 0.3 = weak
- Err on the side of fewer, higher-quality links over many weak ones
- Maximum 50 relationships per batch to keep output manageable
```

### 3.5 New Dependencies (Phase 3)

| Package | Version | Purpose |
|---------|---------|---------|
| `ethers` | `^6.13.0` | Ethereum/Polygon interaction |
| `react-force-graph-2d` | `^1.25.0` | Graph visualization |
| `d3` | `^7.9.0` | Graph layout utilities |

### 3.6 New Environment Variables

```bash
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
POLYMARKET_CTF_ADDRESS=0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E
WEBHOOK_URL=                       # optional, for alert delivery
```

### 3.7 Testing Requirements (Phase 3)

| Test | Acceptance Criteria |
|------|-------------------|
| Wallet indexer | Given mock Transfer events, correctly creates WalletPosition records |
| Wallet classifier | Given features matching SMART_MONEY criteria, classifies correctly |
| Divergence detector | Given 3 SMART_MONEY wallets long at avg 0.70 and market at 0.55, produces signal |
| Graph builder (LLM) | Given mock markets about Fed rate + inflation, identifies CAUSES relationship |
| Consistency checker | Given P(A)=0.8, P(B)=0.7, and A CAUSES B with strength 0.9, detects if P(B) is too low |
| Correlation matrix | Given 30 days of price data for 5 markets, produces correct correlation matrix |
| Webhook delivery | Webhook POST fires within 1s of alert creation |
| SIGINT dashboard | Displays wallet leaderboard and recent moves |
| NEXUS graph | Renders force-directed graph with correct edges and node coloring |

### 3.8 Phase 3 Checkpoints

1. Wallet indexer processes historical Polygon events and populates Wallet + WalletPosition tables.
2. Wallet classifier labels at least some wallets as SMART_MONEY (if data supports it).
3. SIGINT produces divergence signals for Polymarket markets.
4. NEXUS graph builder identifies causal links between related markets.
5. Consistency checker detects joint probability violations.
6. CORTEX now synthesizes 7 modules.
7. SMART_MONEY_MOVE and CAUSAL_INCONSISTENCY alerts fire correctly.
8. Dashboard: SIGINT page shows wallet data, NEXUS page renders graph.
9. Webhook alert delivery works (if configured).

---

## Phase 4: Advanced Modules & Backtesting

### 4.1 New Files

```
apps/api/src/
├── modules/
│   └── reflex.ts                  # REFLEX implementation
├── services/
│   ├── chinese-news-client.ts     # RSS parsing for Chinese sources
│   └── backtest-engine.ts         # Brier score, calibration, P&L sim
├── routes/
│   └── backtest.ts                # GET /backtest/*
├── jobs/
│   ├── weight-update.job.ts       # weekly weight recalculation
│   └── data-retention.job.ts      # nightly data cleanup
└── prompts/
    ├── reflex-system.md
    └── altex-chinese.md

apps/dashboard/src/
├── pages/
│   └── Backtest.tsx
└── components/
    ├── BrierScoreChart.tsx
    ├── CalibrationCurve.tsx
    ├── ModuleScorecard.tsx
    └── EquityCurve.tsx
```

### 4.2 Prisma Schema Changes (Phase 4)

Add model: `ModuleScore`.

### 4.3 REFLEX System Prompt (`apps/api/src/prompts/reflex-system.md`)

```markdown
You are REFLEX, a reflexivity analyst for prediction markets. You detect feedback loops where the market price itself influences the probability of the underlying event.

## Task
Analyze a prediction market for reflexive dynamics — cases where the market price being high/low causally affects the probability of the event occurring.

## Output Format
Respond with valid JSON:
{
  "reflexivityType": "SELF_REINFORCING | SELF_DEFEATING | NEUTRAL | AMBIGUOUS",
  "reflexiveElasticity": number,  // 0-1, estimated % point change in actual probability per 10-point change in market price
  "feedbackMechanism": "string — describe the causal pathway from price to outcome",
  "equilibriumPrice": number | null, // 0-1, the self-consistent fixed point, null if NEUTRAL
  "confidence": number,
  "reasoning": "string — 2-3 sentences"
}

## Examples of Reflexivity
- Political candidate viability: high market → more donors/coverage → more viable (SELF_REINFORCING)
- "Will X be investigated?": high market → target takes defensive action → less likely (SELF_DEFEATING)
- Weather events: market price has no effect on weather (NEUTRAL)
- Bank run prediction: high probability → depositors withdraw → bank fails (SELF_REINFORCING)

## Guidelines
- Most markets are NEUTRAL — reflexivity is the exception, not the rule
- For NEUTRAL markets, set reflexiveElasticity = 0 and equilibriumPrice = null
- Confidence should be low (< 0.4) for AMBIGUOUS cases
- The equilibrium price is where: implied_prob = actual_prob(given that implied_prob is the market price)
```

### 4.4 ALTEX Chinese Sources Prompt (`apps/api/src/prompts/altex-chinese.md`)

```markdown
You are ALTEX-CN, a Chinese-language intelligence analyst. You extract and analyze information from Chinese-language news sources that may not yet be reflected in English-language markets.

## Task
Given Chinese-language articles (from Xinhua, SCMP, Caixin), extract key information and assess its relevance to active prediction markets.

## Output Format
Respond with valid JSON:
{
  "extractedIntelligence": [
    {
      "source": "string — source name",
      "headline": "string — translated headline",
      "keyPoints": ["string — key claim or data point"],
      "policySignal": "string | null — any government policy indication",
      "relevantMarketIds": ["string"],
      "informationAsymmetry": number, // 0-1, how likely this info is NOT yet in English-language coverage
      "probabilityImpact": number,    // -0.30 to +0.30
      "reliability": number           // 0-1, source reliability
    }
  ]
}

## Guidelines
- Focus on: government policy signals, economic data releases, diplomatic statements, regulatory actions
- Chinese state media (Xinhua) often signals policy direction before formal announcements
- Caixin provides independent financial journalism — higher reliability for economic data
- SCMP covers Hong Kong/international angle — good for geopolitical markets
- High information asymmetry = material info not yet in Reuters/AP/Bloomberg English feeds
```

### 4.5 Backtest Engine (`apps/api/src/services/backtest-engine.ts`)

```typescript
interface BacktestResults {
  overall: {
    brierScore: number;
    hitRate: number;
    totalMarkets: number;
    periodStart: Date;
    periodEnd: Date;
  };
  byModule: {
    moduleId: string;
    brierScore: number;
    hitRate: number;
    valueAdded: number;        // CORTEX brier with - without this module
    sampleSize: number;
  }[];
  byCategory: {
    category: MarketCategory;
    brierScore: number;
    hitRate: number;
    sampleSize: number;
  }[];
  calibration: {
    bin: string;               // "0.0-0.1", "0.1-0.2", etc.
    predictedAvg: number;
    actualRate: number;
    count: number;
  }[];
  pnlSimulation: {
    totalReturn: number;
    maxDrawdown: number;
    sharpeRatio: number;
    winRate: number;
    profitFactor: number;
    equityCurve: { date: string; value: number }[];
  };
}
```

**Weight update algorithm** (weekly job):
1. Query all resolved markets in last 90 days.
2. For each module, compute Brier score per category.
3. Compute accuracy multiplier: `1 / (brierScore / avgBrierScore)`.
4. Normalize weights per category so they sum to 1.0.
5. Upsert into `ModuleWeight` table.

### 4.6 New Dependencies (Phase 4)

| Package | Version | Purpose |
|---------|---------|---------|
| `rss-parser` | (already added P2) | Chinese RSS feeds |

### 4.7 Testing Requirements (Phase 4)

| Test | Acceptance Criteria |
|------|-------------------|
| REFLEX with political market | Detects SELF_REINFORCING, produces equilibrium price |
| REFLEX with weather market | Classifies as NEUTRAL |
| ALTEX Chinese pipeline | Parses Xinhua RSS, extracts intelligence, maps to markets |
| Brier score calculation | Given [0.8, YES] → score = 0.04; [0.8, NO] → score = 0.64 |
| Calibration binning | 10 markets at predicted 0.7-0.8, 7 resolve YES → bin shows 0.75 predicted, 0.70 actual |
| Weight update | Given module Brier scores, computes correct new weights |
| P&L simulation | Given edge history + resolutions, produces correct cumulative P&L |
| Data retention job | Removes PriceSnapshot records older than 1 year |

### 4.8 Phase 4 Checkpoints

1. All 8 signal modules produce signals.
2. CORTEX v3 uses accuracy-adaptive weights from backtest data.
3. Backtest engine computes Brier scores, calibration curves, and P&L simulation.
4. Module scorecards show value-add per module.
5. ALTEX processes Chinese-language sources successfully.
6. REFLEX identifies reflexive markets and computes equilibrium prices.
7. Dashboard: Backtest View shows all charts and scorecards.
8. PRICE_SPIKE alerts fire on large price moves.
9. Data retention job runs and cleans up old data.

---

## Phase 5: Optimization & Hardening

### 5.1 New/Modified Files

```
apps/api/src/
├── services/
│   ├── circuit-breaker.ts         # generic circuit breaker wrapper
│   ├── prompt-cache.ts            # LLM prompt caching layer
│   └── portfolio-manager.ts       # updated: correlation-adjusted exposure
├── lib/
│   └── backup.ts                  # pg_dump wrapper for nightly backups
└── jobs/
    └── backup.job.ts              # nightly Postgres backup

apps/dashboard/src/
├── hooks/
│   └── useKeyboardShortcuts.ts    # global keyboard navigation
└── components/
    ├── CommandPalette.tsx          # / key opens command palette
    └── SystemMonitor/
        ├── JobQueueDetail.tsx
        ├── ErrorDrilldown.tsx
        └── CostForecast.tsx
```

### 5.2 Circuit Breaker Pattern

```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;   // 5
  resetTimeout: number;       // 5 minutes
  monitorWindow: number;      // 10 minutes
}

// States: CLOSED (normal) → OPEN (blocking) → HALF_OPEN (testing)
// Track per external service: kalshi, polymarket, polygon, claude, newsapi
```

### 5.3 Correlation-Adjusted Exposure

Update `portfolio-manager.ts` to use NEXUS correlation data:
```typescript
function computeEffectiveExposure(positions: Position[], correlations: Map<string, number>): number {
  // positions[i].size = dollar amount
  // correlations key = "marketId1:marketId2", value = rho
  let sumSquares = 0;
  let sumCross = 0;
  for (const p of positions) sumSquares += p.size ** 2;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const rho = correlations.get(`${positions[i].marketId}:${positions[j].marketId}`) ?? 0;
      sumCross += 2 * rho * positions[i].size * positions[j].size;
    }
  }
  return Math.sqrt(sumSquares + sumCross);
}
```

### 5.4 Prompt Optimization

- Cache system prompts (they don't change per call) — use Anthropic prompt caching.
- For DOMEX: batch multiple markets into a single call per agent when possible.
- Skip LLM analysis for markets with volume < $1,000 or resolution > 90 days away.

### 5.5 Testing Requirements (Phase 5)

| Test | Acceptance Criteria |
|------|-------------------|
| Circuit breaker opens after 5 failures | Subsequent calls return circuit-open error without hitting API |
| Circuit breaker half-open test | After reset timeout, one call is attempted |
| Correlation-adjusted exposure | Given 3 correlated positions, effective exposure > sum of squares |
| Prompt caching | Second call for same prompt uses cache, no API call |
| Pipeline performance | 100 markets processed in < 1 minute (all 8 modules) |
| Keyboard shortcuts | Pressing '1'-'8' navigates to correct page |
| Backup job | pg_dump completes and creates valid backup file |

### 5.6 Phase 5 Checkpoints

1. Circuit breakers protect all external API calls.
2. Correlation-adjusted exposure computed for portfolio.
3. LLM prompt caching reduces API costs by 20%+.
4. Pipeline handles 200+ markets within 5-minute window.
5. Keyboard navigation works across all pages.
6. Nightly backups automated and verified restorable.
7. System Monitor shows full job queue detail and cost forecasting.

---

## Phase 6: Platform Expansion & Automation

### 6.1 New Files

```
apps/api/src/
├── adapters/
│   ├── platform-adapter.ts        # abstract adapter interface
│   ├── kalshi-adapter.ts          # Kalshi-specific logic extracted
│   ├── polymarket-adapter.ts      # Polymarket-specific logic extracted
│   └── manifold-adapter.ts        # new platform (example)
├── services/
│   ├── order-executor.ts          # Kalshi order placement (research)
│   └── position-syncer.ts        # read positions from platform APIs

apps/dashboard/src/
└── pages/
    └── Alerts.tsx                 # mobile-friendly alert-only view
```

### 6.2 Platform Adapter Interface

```typescript
interface PlatformAdapter {
  platform: Platform;
  fetchMarkets(): Promise<NormalizedMarket[]>;
  fetchOrderBook(marketId: string): Promise<NormalizedOrderBook>;
  fetchPrices(marketId: string): Promise<NormalizedPrice>;
  syncPositions?(): Promise<NormalizedPosition[]>;  // optional
  placeOrder?(order: OrderRequest): Promise<OrderResult>;  // optional, P6 research
}
```

### 6.3 Phase 6 Checkpoints

1. Kalshi and Polymarket logic extracted into adapters.
2. Adding a new platform requires only a new adapter file.
3. At least one new platform integrated (Manifold or Metaculus).
4. Position auto-sync reads positions from platform APIs.
5. Mobile alert view accessible and functional.
6. If order execution research completed: documented API flow for Kalshi orders.

---

## Cross-Cutting Additions

### A1. Telegram Alert Delivery (Phase 2)

**New files:**
```
apps/api/src/
├── services/
│   └── telegram.ts                  # Telegram bot message delivery
├── jobs/
│   └── daily-digest.job.ts          # 8 AM ET daily summary
```

**Configuration:**
- Bot: `@LJApexAlertsBot`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ENABLED` env vars
- Rate limit: batch within 5-second windows, max 30 msg/s

**TelegramService class** (`apps/api/src/services/telegram.ts`):
```typescript
class TelegramService {
  sendMessage(text: string, parseMode: 'HTML' | 'Markdown'): Promise<void>;
  sendAlert(alert: AlertRecord, edge?: EdgeOutput, market?: Market): Promise<void>;
  sendDailyDigest(data: DigestData): Promise<void>;
  testConnection(): Promise<boolean>;
}
```

**HTML message templates:**

| Alert Type | Emoji | Content |
|-----------|-------|---------|
| NEW_EDGE | 🔥 | Market title, platform, CORTEX prob vs market price, edge magnitude, direction, confidence, Kelly size, top reasoning |
| SMART_MONEY_MOVE | 🐋 | Wallet address (truncated), market, direction, size, wallet win rate |
| PRICE_SPIKE | ⚡ | Market title, price change, timeframe, volume |
| MODULE_FAILURE | 🚨 | Module ID, consecutive failures, last error |
| EDGE_EVAPORATION | 💨 | Market title, previous edge, reason for evaporation |
| DAILY_DIGEST | 📊 | Active markets, signals generated, top 3 edges, smart money moves, portfolio summary, module health |

**Daily digest** cron: `0 13 * * *` (8 AM ET = 13:00 UTC). BullMQ job `daily-digest`.

**Integration:** `AlertManager.createAlert()` calls `telegramService.sendAlert()` when alert severity >= MEDIUM.

**New env vars:**
```bash
TELEGRAM_BOT_TOKEN=7652746211:AAGhtfJtffFbMGGp-UtTZVshNW-GatA74BU
TELEGRAM_CHAT_ID=424532470
TELEGRAM_ENABLED=true
```

### A2. Memory & Feedback System — MNEMEX (Phase 2 + Phase 4)

**New files:**
```
apps/api/src/
├── services/
│   ├── memory-store.ts              # CRUD for all memory types
│   ├── memory-retriever.ts          # similarity search across stores
│   └── post-mortem-analyzer.ts      # Claude-powered resolution analysis
```

**Prisma models (Phase 2):**
```prisma
model PatternMemory {
  id                  String   @id @default(cuid())
  category            MarketCategory
  pattern             String
  confidence          Float
  occurrences         Int      @default(1)
  lastSeen            DateTime @default(now())
  avgEdgeWhenApplied  Float    @default(0)
  createdAt           DateTime @default(now())
  @@index([category])
}

model MistakeMemory {
  id              String   @id @default(cuid())
  marketId        String
  moduleId        String
  predictedProb   Float
  actualOutcome   String   // 'YES' | 'NO'
  confidence      Float
  rootCause       String   // Claude-generated post-mortem
  lessonsLearned  String
  category        MarketCategory
  createdAt       DateTime @default(now())
  @@index([category, moduleId])
}

model MarketMemory {
  id                      String   @id @default(cuid())
  marketType              String   // e.g., "FOMC_RATE_DECISION", "BTC_PRICE_TARGET"
  historicalBaseRate       Float
  avgResolutionTime       Float    // hours
  commonMispricingPattern String?
  sampleSize              Int
  lastUpdated             DateTime @default(now())
  @@unique([marketType])
}
```

**MemoryRetriever.getRelevantContext(market):**
- Searches PatternMemory by category + keyword similarity
- Searches MistakeMemory for same category + similar market types
- Searches MarketMemory for matching market type
- Returns `MemoryContext` injected into LLM module system prompts

**PostMortemAnalyzer:**
- Triggers on market resolution
- If CORTEX confidence was > 0.6 and prediction was wrong: Claude generates root cause analysis → MistakeMemory
- If CORTEX was correct with high confidence: extracts pattern → PatternMemory
- Auto-populates MarketMemory base rates from resolved markets

### A3. Paper Trade Graduation Gate (Phase 2 + Phase 5)

**New files:**
```
apps/api/src/
├── services/
│   ├── paper-trader.ts              # auto paper positions for edges
│   └── graduation.ts               # graduation criteria engine
```

**Signal lifecycle:** `DETECTED → PAPER → GRADUATED → LIVE → RESOLVED`

**PaperPosition Prisma model (Phase 2):**
```prisma
model PaperPosition {
  id                String        @id @default(cuid())
  marketId          String
  market            Market        @relation(fields: [marketId], references: [id])
  direction         EdgeDirection
  entryPrice        Float
  currentPrice      Float
  kellySize         Float
  paperPnl          Float         @default(0)
  status            String        @default("OPEN") // OPEN | CLOSED | RESOLVED
  enteredAt         DateTime      @default(now())
  closedAt          DateTime?
  edgeAtEntry       Float
  confidenceAtEntry Float
  @@index([marketId])
  @@index([status])
}
```

**PaperTrader service:**
- Auto-enters paper position for every actionable edge (EV > 0.03)
- Updates `currentPrice` and `paperPnl` on each market sync
- Closes position when edge evaporates or market resolves

**GraduationEngine (Phase 5):**
```typescript
interface GraduationCriteria {
  minResolvedPaperTrades: 20;
  minWinRate: 0.55;
  minProfitFactor: 1.3;
  minAvgEdge: 0.03;
  maxSingleLossRatio: 2.0;  // max single loss / avg win
}
```

**Risk Control Gate (hard limits, Phase 5):**
```typescript
const RISK_HARD_LIMITS = {
  MAX_PER_POSITION: 10,       // $10
  MAX_DAILY_NEW: 30,          // $30 new positions per day
  MAX_SIMULTANEOUS: 5,        // 5 open positions
  MAX_TOTAL_DEPLOYED: 100,    // $100 total
};
```
Stored in `SystemConfig` key `risk_limits`.

**Dashboard badges:** `📝 PAPER ONLY` before graduation, `🎓 GRADUATED` after.

### A4. LLM Cost Tiering (Phase 1 + Phase 2)

**New files:**
```
packages/shared/src/
└── llm-router.ts                    # model selection + cost tracking

apps/api/src/
├── services/
│   └── llm-client.ts               # unified LLM client (replaces single Claude client)
```

**Three tiers:**

| Tier | Models | Cost/call | Use Cases |
|------|--------|-----------|-----------|
| TIER_1 | Claude Haiku / gpt-4o-mini | ~$0.001 | News filtering, initial screening, classification |
| TIER_2 | Claude Sonnet | ~$0.01 | Expert analysis, deep parsing, Chinese intel |
| TIER_3 | Claude Sonnet + extended thinking | ~$0.05 | Conflict resolution, post-mortems, causal graphs |

**LLMRouter interface:**
```typescript
interface LLMRouter {
  getConfig(task: LLMTask): ModelConfig;
  complete<T>(task: LLMTask, systemPrompt: string, userMessage: string): Promise<LLMResponse<T>>;
  getDailyUsage(): Promise<{ cost: number; calls: number; budget: number }>;
}

type LLMTask =
  | 'SCREEN_NEWS'        // TIER_1
  | 'SCREEN_MARKET'      // TIER_1
  | 'LEGEX_ANALYSIS'     // TIER_2
  | 'DOMEX_AGENT'        // TIER_2
  | 'ALTEX_ANALYSIS'     // TIER_2
  | 'ALTEX_CHINESE'      // TIER_2
  | 'NEXUS_CAUSAL'       // TIER_2
  | 'REFLEX_ANALYSIS'    // TIER_2
  | 'CONFLICT_RESOLVE'   // TIER_3
  | 'POST_MORTEM'        // TIER_3
  | 'GRAPH_BUILD';       // TIER_3
```

**Two-pass pattern:**
1. TIER_1 screens: "Is this market/article worth deep analysis?" (~$0.001)
2. Only markets that pass screening go to TIER_2/TIER_3 (~$0.01-0.05)
3. Expected cost reduction: 40-60%

**Budget tracking:** `LLM_DAILY_BUDGET` in env vars. Alert when 80% consumed. Hard stop at 100%.

**New env vars:**
```bash
OPENROUTER_API_KEY=              # optional, for gpt-4o-mini access
LLM_DAILY_BUDGET=10.00
LLM_BUDGET_ALERT_THRESHOLD=8.00
```

### A5. Cross-Platform Arbitrage Scanner — ARBEX (Phase 1 + Phase 3)

**New files:**
```
apps/api/src/
├── modules/
│   └── arbex.ts                     # ARBEX arbitrage scanner
├── services/
│   ├── fee-calculator.ts            # platform fee calculation
│   └── market-matcher.ts            # cross-platform event matching
```

**ARBEX is the 9th signal module** (added to MODULE_IDS). Runs every 60 seconds (arb-sensitive).

**Three arbitrage types:**

1. **INTRA-PLATFORM ARB:** Same platform, YES + NO < $1.00 after fees.
2. **CROSS-PLATFORM ARB:** Same event on Kalshi vs Polymarket. Match via title similarity + Claude confirmation.
3. **SYNTHETIC ARB (Phase 3):** Uses NEXUS causal graph. Logically constrained prices that are inconsistent.

**Fee calculator:**
```typescript
// Kalshi fee: ceil(0.07 × contracts × price × (1 - price))
function calculateKalshiFee(price: number, contracts: number): number;

// Polymarket: generally 0 for most markets (fees on withdrawal)
function calculatePolymarketFee(price: number, contracts: number): number;

// Net arb after fees
function calculateNetArb(
  yesPrice: number, noPrice: number,
  yesPlatform: Platform, noPlatform: Platform,
  contracts: number
): { netProfit: number; grossSpread: number; totalFees: number };
```

**Market matcher** (`apps/api/src/services/market-matcher.ts`):

**Ingestion-time matching** (one LLM call per new market, stored permanently):
1. When a new market is created during market-sync, `matchNewMarket()` is called
2. **Jaccard pre-filter**: finds top 5 candidates from the other platform (threshold ≥ 0.35)
3. If best Jaccard ≥ 0.80: store match directly (no LLM needed)
4. If 0.35-0.80: **one Claude Haiku call** to verify top candidates
5. Results stored permanently in `MarketMatch` table (never re-computed)

**Arb-scan lookup** (zero LLM calls, pure DB read):
- `getPrecomputedMatches()` reads from `MarketMatch` table
- Arb scan runs every 60 seconds with **zero LLM cost** — just price comparison math

**MarketMatch table:**
```prisma
model MarketMatch {
  kalshiMarketId      String
  polymarketMarketId  String
  matchConfidence     Float    // 0-1 similarity
  matchMethod         String   // "jaccard" | "llm"
  matchedAt           DateTime
  @@unique([kalshiMarketId, polymarketMarketId])
}
```

**Signal characteristics:**
- Decay: `halfLifeMinutes: 15` (arbs are time-sensitive)
- Confidence: 0.95 for pure arbs, 0.5-0.7 for synthetic
- Runs on `arb-scan` BullMQ queue every 60 seconds

**Telegram template:** `⏰ ARB ALERT` with time-sensitivity rating (URGENT/NORMAL)

### A6. Latency Arbitrage for Crypto Markets — SPEEDEX (Phase 3)

**New files:**
```
apps/api/src/
├── modules/
│   └── speedex.ts                   # latency arbitrage detector
├── services/
│   ├── crypto-feed.ts               # Binance/Coinbase WebSocket price streams
│   └── threshold-matcher.ts         # maps crypto markets to price thresholds
```

**How it works:**
1. `CryptoFeedService` maintains WebSocket connections to Binance and Coinbase for BTC, ETH, SOL real-time prices.
2. `ThresholdMatcher` maps crypto prediction markets (e.g., "BTC > $65K by Friday") to price thresholds.
3. `SPEEDEX` detects when crypto price moves toward a threshold but the prediction market hasn't repriced yet (2-15s lag typical).

**CryptoFeedService:**
```typescript
class CryptoFeedService {
  subscribe(symbol: 'BTC' | 'ETH' | 'SOL'): void;
  getPrice(symbol: string): { price: number; timestamp: number };
  onPriceUpdate(callback: (symbol: string, price: number) => void): void;
}
```

**Signal characteristics:**
- Very short decay: `halfLifeMinutes: 15` (0.25 hours)
- High confidence when latency is detected (0.7-0.9)
- Only applies to crypto price prediction markets

**New env vars:**
```bash
BINANCE_WS_URL=wss://stream.binance.com:9443/ws
COINBASE_WS_URL=wss://ws-feed.exchange.coinbase.com
```

**New dependencies:**
| Package | Version | Purpose |
|---------|---------|---------|
| `ws` | `^8.18.0` | WebSocket client for crypto feeds |

### A7. Copy Trading / Whale Tracking Enhancement (Phase 3)

**New files:**
```
apps/api/src/
├── modules/
│   └── sigint/
│       ├── fresh-wallet-detector.ts  # new wallet insider detection
│       ├── wallet-clusterer.ts       # group wallets by funding source
│       └── copy-trade-signal.ts      # time-to-impact tracking
```

**FreshWalletDetector:**
- Track wallet age (blocks since first transaction)
- Flag: wallet age < 7 days AND first position > $5K
- Severity scoring: `(position_size / 5000) × (7 / wallet_age_days) × proximity_to_resolution`

**WalletClusterer:**
- Track ETH/MATIC funding source for each wallet
- If multiple wallets funded from same source AND trade same markets → cluster as single entity
- Report cluster combined position size (stronger signal than individual)

**CopyTradeSignal:**
- For wallets with win rate > 70%: track time from entry to price movement
- If smart money consistently moves prices 5-15 min after entry → that's our execution window
- Signal includes: `timeToImpactMinutes`, `historicalAccuracy`, `suggestedEntryWindow`

**Telegram template:** `🕵️ INSIDER ALERT` for fresh wallet detections

### A8. Event Calendar & Scheduled Catalyst Tracker (Phase 2 + Phase 4)

**New files:**
```
apps/api/src/
├── services/
│   └── event-calendar.ts            # catalyst event tracking
├── jobs/
│   └── event-sync.job.ts            # fetch/update event calendars
```

**ScheduledEvent Prisma model (Phase 2):**
```prisma
model ScheduledEvent {
  id                  String         @id @default(cuid())
  title               String
  date                DateTime
  category            MarketCategory
  source              String
  expectedVolatility  String         @default("medium") // low, medium, high
  description         String?
  relatedMarketIds    String[]       // market IDs mapped via Claude
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt
  @@index([date])
  @@index([category])
}
```

**Static calendar sources (Phase 2):**
- FOMC meeting dates (scraped from federalreserve.gov)
- BLS release calendar (CPI, jobs report, GDP dates)

**Extended sources (Phase 4):**
- Earnings calendars
- Court hearing schedules (PACER)
- Crypto events: halvings, ETF decision dates, major unlocks

**Integration:**
- Maps events to active markets via title matching + Claude
- Pre-catalyst alerts: "⏰ FOMC decision in 24h. 3 related markets with active edges."
- CORTEX confidence boost when signal aligns with expected catalyst direction
- FLOWEX context: don't flag catalyst-day volume spikes as anomalies

### A9. Unified Prediction Market API Abstraction (Phase 1 refactor)

This replaces the Phase 6 adapter refactoring by doing it upfront. Current `KalshiClient` and `PolymarketClient` are refactored to implement a shared `PredictionMarketAdapter` interface.

**PredictionMarketAdapter interface** (`packages/shared/src/platform-adapter.ts`):
```typescript
interface PredictionMarketAdapter {
  readonly platform: Platform;

  // Market data
  getMarkets(params?: MarketQuery): Promise<RawMarket[]>;
  getMarket(id: string): Promise<RawMarket>;
  getOrderbook(id: string): Promise<RawOrderbook>;
  getPriceHistory?(id: string, params?: HistoryQuery): Promise<RawPricePoint[]>;

  // Normalization
  normalizeMarket(raw: RawMarket): NormalizedMarket;
  normalizeOrderbook(raw: RawOrderbook): NormalizedOrderbook;

  // Fee calculation
  calculateFee(price: number, quantity: number, side: 'buy' | 'sell'): number;

  // Execution (optional, Phase 6)
  placeOrder?(params: OrderParams): Promise<OrderResult>;
  cancelOrder?(orderId: string): Promise<void>;
  getPositions?(): Promise<NormalizedPosition[]>;

  // Health
  healthCheck(): Promise<boolean>;
}
```

**Refactoring scope:**
- Extract Kalshi-specific logic into `KalshiAdapter implements PredictionMarketAdapter`
- Extract Polymarket-specific logic into `PolymarketAdapter implements PredictionMarketAdapter`
- Update `market-sync.ts` to iterate registered adapters
- Update `orderbook-sync.ts` to use adapter `getOrderbook()`
- All existing functionality preserved, code cleaner and extensible

**Phase 6 additions become:** implement `ManifoldAdapter` and `MetaculusAdapter` — now trivial.

---

### A10. TRADEX — Automated Execution Engine (Phase 1 + Phase 2 + Phase 3 + Phase 5)

**Rationale:** Speed-sensitive edges (arbs average 2.7 seconds) evaporate before manual execution. Without automated execution, ARBEX/SPEEDEX/FLOWEX signals are informational-only. TRADEX ships in Phase 1 (demo mode) with live execution graduating in Phase 3.

**New workspace:** `packages/tradex/`

```
packages/tradex/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # re-exports ExecutionManager, executors, types
    ├── types.ts                    # ExecutionMode, PreflightResult, OrderRequest, OrderResult
    ├── manager.ts                  # ExecutionManager: routing, preflight, circuit breaker
    ├── preflight.ts                # 7-gate preflight check implementation
    ├── risk-limits.ts              # Risk limit loading from SystemConfig, hard ceiling enforcement
    ├── executors/
    │   ├── base.ts                 # BaseExecutor abstract class
    │   ├── kalshi.ts               # KalshiExecutor: REST + HMAC, demo/prod toggle
    │   └── polymarket.ts           # PolymarketExecutor: CLOB + EIP-712 signing
    └── telegram/
        └── reply-listener.ts       # Polls getUpdates for ✅/❌ replies on SLOW_EXEC
```

**Dashboard additions:**
```
apps/dashboard/src/
├── pages/
│   ├── Execution.tsx              # live order status, execution log, arb tracker, daily P&L, platform balances
│   └── Settings.tsx               # risk limit sliders with hard ceilings, CONFIRM modal
├── components/
│   ├── KillSwitch.tsx             # big red toggle for TRADEX_ENABLED
│   ├── RiskLimitSlider.tsx        # slider with hard ceiling max, current value display
│   └── ConfirmModal.tsx           # requires typing "CONFIRM" to save risk limit changes
```

**API routes:**
```
apps/api/src/routes/
└── execution.ts                   # GET /execution/log, /execution/positions, /execution/balances, POST /execution/kill-switch
```

#### Two Execution Modes

**FAST_EXEC** (auto, no human confirmation):
- Signal sources: ARBEX arb signals, SPEEDEX latency signals, FLOWEX mean reversion, SIGINT copy trades
- Executes automatically through risk gate — speed is the edge, any delay kills it
- Marketable limit orders: price = best ask + 1-2 cents

**SLOW_EXEC** (Telegram confirmation):
- Signal sources: DOMEX, LEGEX, COGEX, REFLEX, NEXUS, ALTEX signals
- Sends Telegram alert with full edge details, LJ replies ✅ to execute or ❌ to skip
- Auto-expires after 2 hours if no reply
- TelegramService polls `getUpdates` every 5 seconds for replies
- Limit orders at CORTEX fair value

#### Telegram Execution Flow (SLOW_EXEC)

1. Send: `"🔔 EDGE OPPORTUNITY — reply ✅ to execute or ❌ to skip"` with edge details (market, direction, size, price, edge magnitude, confidence)
2. Poll `getUpdates` every 5 seconds for reply to that message
3. On ✅: `ExecutionManager.execute()` with re-validated preflight
4. On ❌: log as skipped in ExecutionLog
5. After 2 hours with no reply: auto-skip, log as expired
6. After execution: send confirmation with fill price, fee, position ID

#### KalshiExecutor (`packages/tradex/src/executors/kalshi.ts`)

```typescript
class KalshiExecutor extends BaseExecutor {
  platform = 'KALSHI';

  // REST API with HMAC-signed requests (same auth as KalshiClient)
  // Start with KALSHI demo environment (fake money sandbox)
  // Demo URL: https://demo-api.kalshi.co/trade-api/v2
  // Prod URL: https://trading-api.kalshi.com/trade-api/v2

  async placeOrder(params: {
    ticker: string;
    side: 'yes' | 'no';
    action: 'buy' | 'sell';
    type: 'market' | 'limit';
    count: number;       // number of contracts
    yesPrice: number;    // in cents (1-99)
  }): Promise<OrderResult>;

  async cancelOrder(orderId: string): Promise<void>;
  async getPositions(): Promise<KalshiPosition[]>;
  async getBalance(): Promise<{ available: number; deployed: number }>;

  // Fee calculation: ceil(0.07 × contracts × price × (1 - price))
  calculateFee(contracts: number, price: number): number;
}
```

- FAST_EXEC: marketable limit orders (price = best ask + 1-2 cents) for immediate fill
- SLOW_EXEC: limit orders at CORTEX fair value for better entry

#### PolymarketExecutor (`packages/tradex/src/executors/polymarket.ts`)

```typescript
class PolymarketExecutor extends BaseExecutor {
  platform = 'POLYMARKET';

  // CLOB API with on-chain settlement on Polygon
  // Auth: L1 EIP-712 signing with ETH wallet, L2 HMAC credentials for API
  // Settlement in USDC on Polygon

  async placeOrder(params: {
    tokenId: string;     // CLOB token ID
    side: 'BUY' | 'SELL';
    price: number;       // 0.01-0.99
    size: number;        // in USDC
  }): Promise<OrderResult>;

  async cancelOrder(orderId: string): Promise<void>;
  async getPositions(): Promise<PolymarketPosition[]>;
  async getBalance(): Promise<{ usdc: number }>;
  async approveAllowance(amount: number): Promise<string>; // tx hash
}
```

- Requires: dedicated ETH wallet (private key in `.env`), USDC on Polygon

#### ExecutionManager (`packages/tradex/src/manager.ts`)

```typescript
class ExecutionManager {
  // Routes execution to correct platform executor
  // Determines FAST_EXEC vs SLOW_EXEC based on signal source

  async preflight(edge: EdgeOutput, platform: Platform): Promise<PreflightResult> {
    // 7 gates — ALL must pass:
    // 1. Risk gate: position size within per-trade limit?
    // 2. Balance check: enough funds on platform?
    // 3. Edge still valid: re-fetch price, recalculate, still > threshold?
    // 4. Fee check: edge > platform fees?
    // 5. Graduation check: edge type graduated from paper? (Phase 5, pass-through until then)
    // 6. Daily limit check: new trade amount under daily cap?
    // 7. Position count check: under max simultaneous positions?
  }

  async execute(edge: EdgeOutput, platform: Platform, mode: ExecutionMode): Promise<ExecutionLog>;

  async executeArb(arbSignal: ArbSignal): Promise<ArbExecution> {
    // Places BOTH legs simultaneously
    // If one leg fails, immediately cancels the other
    // Returns ArbExecution with status
  }

  // Circuit breaker: 3 consecutive failures on a platform = 15 min pause
  private circuitBreakers: Map<Platform, CircuitBreaker>;
}
```

#### Risk Limits

Stored in `SystemConfig` key `tradex_risk_limits`, editable via dashboard Settings page. Each limit has a current value (adjustable via UI) and a hard ceiling (requires code change):

| Limit | Default | Hard Ceiling | Description |
|-------|---------|-------------|-------------|
| Max per trade | $10 | $500 | Maximum size for a single trade |
| Max daily new trades | $30 | $1,000 | Total new trade volume per day |
| Max simultaneous positions | 5 | 25 | Open positions at once |
| Max total deployed | $100 | $5,000 | Total capital deployed across all platforms |
| Consecutive loss halt | 3 | 10 | Halt after N consecutive losing trades |
| Daily P&L halt | -$15 | -$500 | Halt all trading if daily P&L hits threshold |
| Max arb executions/hr | 3 | 50 | Rate limit on arb execution |

Dashboard Settings page shows sliders for each limit with the ceiling as max value. Changes require typing "CONFIRM" in a modal (prevents accidental slider bumps). All limit changes logged in `AuditLog` model. Telegram notification when any limit is changed: `"⚙️ Risk limit updated: max per trade $10 → $25"`.

#### Prisma Models (TRADEX)

```prisma
model ExecutionLog {
  id              String   @id @default(cuid())
  edgeId          String
  edge            Edge     @relation(fields: [edgeId], references: [id])
  marketId        String
  market          Market   @relation(fields: [marketId], references: [id])
  platform        Platform
  direction       EdgeDirection
  orderType       String   // 'market_limit' | 'limit'
  requestedPrice  Float
  filledPrice     Float?
  requestedSize   Float
  filledSize      Float?
  fee             Float?
  status          ExecutionStatus  // PENDING, FILLED, PARTIAL, FAILED, CANCELLED, EXPIRED
  executionMode   ExecutionMode    // FAST_EXEC, SLOW_EXEC
  latencyMs       Int?
  errorMessage    String?
  createdAt       DateTime @default(now())
  filledAt        DateTime?

  arbLeg1 ArbExecution[] @relation("leg1")
  arbLeg2 ArbExecution[] @relation("leg2")
}

model ArbExecution {
  id          String   @id @default(cuid())
  leg1LogId   String
  leg1        ExecutionLog @relation("leg1", fields: [leg1LogId], references: [id])
  leg2LogId   String
  leg2        ExecutionLog @relation("leg2", fields: [leg2LogId], references: [id])
  grossSpread Float
  netProfit   Float?
  status      ArbStatus  // BOTH_FILLED, PARTIAL, FAILED
  createdAt   DateTime @default(now())
}

model AuditLog {
  id            String   @id @default(cuid())
  setting       String
  previousValue String
  newValue      String
  changedAt     DateTime @default(now())
}

enum ExecutionStatus {
  PENDING
  FILLED
  PARTIAL
  FAILED
  CANCELLED
  EXPIRED
}

enum ExecutionMode {
  FAST_EXEC
  SLOW_EXEC
}

enum ArbStatus {
  BOTH_FILLED
  PARTIAL
  FAILED
}
```

#### Environment Variables (TRADEX)

```bash
# TRADEX — Execution Engine
TRADEX_ENABLED=false                    # Master kill switch — must explicitly enable
TRADEX_FAST_EXEC_ENABLED=false          # Separate toggle for auto-execution

# Kalshi Execution
KALSHI_API_KEY=                         # Same as data API key
KALSHI_API_SECRET=                      # Same as data API secret
KALSHI_USE_DEMO=true                    # Start in demo/sandbox mode

# Polymarket Execution
POLYMARKET_PRIVATE_KEY=                 # Dedicated ETH wallet private key
POLYGON_RPC_URL=https://polygon-rpc.com # Polygon RPC endpoint
```

---

## v2 Architecture Additions

The following features were built after the initial spec and represent significant architectural upgrades. They are documented here as the authoritative reference.

### V2.1 Opportunity Lifecycle & State Machine

**Files:**
- `apps/api/src/services/opportunity-machine.ts` — state machine
- `apps/api/src/routes/opportunities.ts` — API routes
- Prisma models: `Opportunity`, `OpportunityTransition`

Every edge detected by CORTEX becomes an **Opportunity** that moves through a defined state machine:

```
DISCOVERED → RESEARCHED → RANKED → APPROVED → PAPER_TRACKING → ORDERED → FILLED → MONITORING → RESOLVED
                                  ↓                                  ↓
                              CLOSED (failed/cancelled)
```

Each transition is logged in `OpportunityTransition` with timestamp, metadata, and the triggering module. The opportunity tracks:
- Mode: RESEARCH vs SPEED
- Discovered-by attribution (which module found it)
- Market price at discovery
- Full audit trail for post-mortem analysis

**Attribution scoring** on resolved opportunities:
- Thesis correctness rate
- Execution quality (1-5 scale)
- Fee drag (% of edge lost to fees)
- Timing score (entry/exit quality)
- Realized P&L
- Alpha decomposition per module

### V2.2 Split CORTEX into `packages/cortex` (4 Engines)

**Files:** `packages/cortex/src/`

The monolithic CORTEX engine was split into 4 independent, composable engines:

**Signal Fusion Engine** (`signal-fusion.ts`) — **CANONICAL probability fusion implementation**:
- Weighted combination of raw signals from 11 modules
- Per-module time decay constants (SPEEDEX 5min, CRYPTEX 10min, FLOWEX 30min, ARBEX 15min, etc.)
- Agreement scoring (0-1 disagreement metric)
- Module weights: SPEEDEX (0.20), ARBEX (0.18), COGEX (0.15), CRYPTEX (0.15), FLOWEX (0.12), LEGEX (0.10), DOMEX (0.10), ALTEX (0.08), SIGINT (0.08), REFLEX (0.05), NEXUS (0.04)
- **Note**: `engine/cortex.ts` delegates to `fuseSignals()` for all probability fusion. There is no duplicate fusion logic — `cortex.ts` handles calibration, edge calculation, and Kelly sizing around the canonical fusion call.

**Calibration Engine** (`calibration-memory.ts`):
- Per-module, per-category historical bias correction
- Tracks avgOverestimate, avgAbsError, Brier score
- Time-bucketed calibration (hours/days/weeks/months)
- Recalibrates weekly from resolved markets
- Requires 10+ samples before applying correction
- **Wired into live pipeline**: `engine/cortex.ts` calls `applyCalibration()` on every signal before fusion. Corrections are applied pre-synthesis so the fusion engine operates on bias-corrected probabilities.

**Opportunity Scoring Engine** (`opportunity-scoring.ts`):
- Edge magnitude: |fair_value - market_price|
- Expected value: net_edge x confidence
- Capital efficiency: EV / sqrt(days_to_resolution)
- Quarter-Kelly sizing for safety
- Fee drag calculation (Kalshi: 7% x price x (1-price), Polymarket: 2%)
- Actionability thresholds: MIN_EDGE=2%, MIN_EV=0.5%, MIN_CONFIDENCE=10%, MIN_VOLUME=$100

**Portfolio Allocator** (`portfolio-allocator.ts`):
- Category budgets: CRYPTO 30%, POLITICS 15%, SPORTS 20%, FINANCE 15%, OTHER 10%, SCIENCE 5%, ENTERTAINMENT 5%
- Daily capital deployment cap ($30 default)
- Max simultaneous positions (5 default)
- Max total deployed ($100 default)
- Concentration limits: single market 5%, single category 25%
- `resetDaily()` clears daily trade counter at midnight

### V2.3 Dual Mode Worker (RESEARCH / SPEED)

**File:** `apps/api/src/services/dual-mode-pipeline.ts`

Markets are classified into two processing modes based on time to resolution:

**RESEARCH mode** (closesAt > 24 hours):
- Full LLM pipeline: COGEX, FLOWEX, LEGEX, DOMEX, ALTEX, REFLEX, SIGINT, NEXUS
- 15-minute cycle
- SLOW_EXEC (Telegram confirmation)

**SPEED mode** (closesAt < 24 hours):
- Math-only modules: SPEEDEX, CRYPTEX, ARBEX, FLOWEX, COGEX
- 30-second cycle via `speed-pipeline.job.ts`
- FAST_EXEC (auto-execution)

`classifyMode(market)` determines mode based on `closesAt` timestamp.

### V2.4 Feature Model (Logistic Regression over LLM Features)

**File:** `packages/cortex/src/feature-model.ts`

Structured feature extraction from LLM agent outputs, fed into a logistic regression model for calibrated probability estimates:

- **FedHawkFeatures**: fedFundsRate, cpiTrend, dotPlotDirection, fedSpeechTone, marketImpliedRate, yieldCurveSpread
- **GeoIntelFeatures**: incumbentApproval, pollingSpread, legislativeStatus, keyDatesAhead, escalationLevel, sanctionIntensity
- **SportsEdgeFeatures**: homeAway, restDays, injuryImpact, recentForm, headToHeadRecord, eloRating, lineMovement
- **CryptoAlphaFeatures**: fundingRate, exchangeFlows, protocolTVL, regulatoryNews, volatilityRatio, orderBookImbalance
- **LegexFeatures**: ambiguityScore, misinterpretationRisk, resolutionSourceReliability, edgeCaseCount, crossPlatformDivergence
- **AltexFeatures**: newsRelevance, sentimentDirection, informationAsymmetry, upcomingCatalysts, sourceReliability

Weekly retraining on resolved markets. Falls back to base rates with insufficient data.

### V2.5 Implied Volatility Model

**File:** `packages/cortex/src/implied-vol-model.ts`

Black-Scholes-like pricing for crypto bracket/floor contracts:
- Log-normal distribution with CDF approximation (Abramowitz & Stegun)
- Realized volatility from price history (annualized)
- `priceFloorContract(S, K, vol, T)`: P(S > K) calculation
- `priceBracketContract(S, lower, upper, vol, T)`: P(lower <= S_T <= upper)
- Default 57% annualized vol if insufficient price data

### V2.6 DOMEX v2: Feature Extraction Architecture (7 Agents)

**Files:** `apps/api/src/modules/domex-agents/` + `apps/api/src/modules/domex.ts`

**Critical change: Agents are FEATURE EXTRACTORS, not probability oracles.**

Previous architecture asked Claude to estimate probabilities directly (anchoring to market price → biased outputs). New architecture:

1. **Market price NEVER shown to agents** — prevents anchoring bias
2. **Agents extract structured feature vectors** (not probabilities)
3. **FeatureModel (logistic regression)** converts combined features → calibrated probability
4. **Demoted to TIER_1/Haiku** for feature extraction (~75% cost reduction)

| Agent | Categories | Data Sources | Features Extracted |
|-------|-----------|-------------|-------------------|
| FED-HAWK | FINANCE | FRED (CPI, PCE, unemployment, yields, breakeven inflation, claims, sentiment), CME FedWatch | questionType, cpiTrend, laborMarketTightness, fedCommunicationTone, recentDataSurprise, cmeCutProbability, geopoliticalRisk, financialStress |
| GEO-INTEL | POLITICS | Polling data, Congress.gov (with `estimatePassageProbability()` base rates) | questionType, pollingSpread, pollingTrend, incumbentRunning, billStage, cosponsorCount, bipartisanSupport, conflictIntensity, escalationTrend |
| CRYPTO-ALPHA | CRYPTO | Binance WebSocket (live prices, 24h change, volume, funding rates) | priceVs30dAvg, fundingRate, exchangeNetFlow, protocolTVLTrend, majorUpgrade, regulatoryAction |
| SPORTS-EDGE | SPORTS | The Odds API (the-odds-api.com, 500 req/month, 1hr cache) + ESPN public API (free, no key) — live odds, injuries, standings, schedule | **bookmakerImpliedProb**, homeAway, restDays, injuryImpact, recentFormLast10, headToHeadRecord, lineMovement, sport |
| WEATHER-HAWK | SCIENCE | NWS API (api.weather.gov, free) | forecastLeadDays, forecastConfidence, nwsForecastAvailable, forecastedCondition, forecastedTempF, climatologicalBaseRate, modelAgreement |
| LEGAL-EAGLE | POLITICS | CourtListener API (free, courtlistener.com) | caseType, courtLevel, oralArgumentHeld, questionPresented, circuitSplitExists, historicalReverseRate, proceduralStage |
| CORPORATE-INTEL | FINANCE | Finnhub (finnhub.io, free tier 60 calls/min) — earnings dates, analyst estimates, SEC filings; OpenFDA API (free) — FDA approval tracking | eventType, earningsSurpriseHistory, revenueGrowthTrend, analystConsensus, sectorMomentum, insiderActivity, regulatoryRisk |

**ENTERTAINMENT-SCOUT removed** — no data sources, zero edge potential, CULTURE markets too unpredictable.

**Aggregation flow:** Agent feature vectors → mapped to typed FeatureVector → fed into `predict()` from `@apex/cortex/feature-model.ts` → calibrated probability with confidence and feature importance ranking.

**DomexAgentResult interface (v2):**
```typescript
interface DomexAgentResult {
  features: Record<string, string | number | boolean | null>;
  reasoning: string;
  dataSourcesUsed: string[];
  dataFreshness: 'live' | 'cached' | 'stale' | 'none';
}
```

### V2.6.1 FeatureModel Training & Learning Loop

**Files:** `packages/cortex/src/feature-model.ts`, `apps/api/src/jobs/learning-loop.job.ts`

**Critical architecture: Without the learning loop, every LLM credit is wasted.**

The learning loop runs weekly (Sunday 2 AM UTC) and closes the feedback loop between predictions and outcomes:

1. **Query resolved markets** — all markets with known outcomes from the last 180 days
2. **Build training data** — reconstruct FULL FeatureVector from stored signal metadata (all 40+ domain features), pair with binary outcome (YES=1, NO=0)
3. **Retrain FeatureModel** — gradient descent logistic regression, minimum 20 samples, 100 epochs
4. **Persist weights** — serialized to `SystemConfig.feature_model_weights` in DB
5. **Recalibrate** — compute per-module, per-category bias corrections from signal accuracy
6. **Persist calibration** — serialized to `SystemConfig.calibration_records` in DB
7. **Telegram summary** — sends accuracy change, Brier score, training samples, calibration records to Telegram

**On worker startup:** Both model weights and calibration records are restored from DB via `loadModel()` and `loadCalibration()`.

**Price anchoring prevention:** `priceLevel` weight is 0 in DEFAULT_WEIGHTS. Market price ONLY enters at edge calculation (`cortexProbability - marketPrice`), never as a model input. This ensures independent probability estimates.

**FeatureModel typed schemas:** All 7 DOMEX agents (FED-HAWK, GEO-INTEL, CRYPTO-ALPHA, SPORTS-EDGE, WEATHER-HAWK, LEGAL-EAGLE, CORPORATE-INTEL) have typed feature interfaces mapped in `buildFeatureVector()`. No agent falls through to `default:break`.

**Full feature vector storage:** DOMEX stores the complete serialized FeatureVector (all 40+ numeric features) in `Signal.metadata.featureVector`. The learning loop reads this to reconstruct rich training data. Without full storage, the model can only train on base features (price, volume, spread) and loses all domain-specific signal.

**Supporting scheduled jobs:**
| Job | Schedule | Purpose |
|-----|----------|---------|
| `learning-loop` | Weekly Sun 2 AM UTC | Retrain model + recalibrate |
| `backtest` | Weekly Sun 4 AM UTC | Populate ModuleScore records |
| `weight-update` | Hourly | Adjust module weights from ModuleScore |
| `paper-position-update` | Every 5 min | Update paper P&L with current prices |
| `position-reconciliation` | Every 5 min | Close resolved positions, calculate final P&L |

### V2.6.2 Paper Trade Fee Modeling

**File:** `apps/api/src/services/paper-trader.ts`

Paper positions now subtract estimated fees at both entry AND exit to make P&L realistic:
- **Kalshi fee model:** 7% × price × (1 - price) per contract per side
- **Entry:** BUY_YES price adjusted UP by fee, BUY_NO adjusted DOWN
- **Exit (take-profit/stale):** exit fee deducted from P&L: `grossPnl - estimateFee(currentPrice) × kellySize`
- **Exit (resolution):** zero fee — Kalshi doesn't charge on contract settlement at $1 or $0
- **Ongoing P&L:** open positions show fee-adjusted P&L (exit fee estimated at current price)
- **EDGE_ACTIONABILITY_THRESHOLD:** increased from 0.5% to 3% — edges below 3% are negative EV after Kalshi round-trip fees

### V2.6.3 Data Source Requirements Per Agent

| Agent | Required API Key | Env Var | Free Tier |
|-------|-----------------|---------|-----------|
| FED-HAWK | FRED | `FRED_API_KEY` | Unlimited |
| GEO-INTEL | Congress.gov | `CONGRESS_API_KEY` | Unlimited |
| CRYPTO-ALPHA | None (Binance WS) | `BINANCE_WS_ENABLED` | Unlimited |
| SPORTS-EDGE | The Odds API + ESPN | `ODDS_API_KEY` | 500 req/month (1hr cache) + unlimited ESPN |
| WEATHER-HAWK | None (NWS) | N/A | Unlimited |
| LEGAL-EAGLE | None (CourtListener) | N/A | Rate limited |
| CORPORATE-INTEL | Finnhub + OpenFDA | `FINNHUB_API_KEY` | 60 calls/min |

### V2.7 Crypto Strategy Engine (CRYPTEX)

**Files:** `apps/api/src/modules/crypto-strategy/`

Four specialized crypto modules with in-memory caching (5-min TTL per symbol):

- **FundingRateModule** (`funding-rate.ts`): Perpetual futures funding arbitrage signals
- **SpotBookImbalanceModule** (`spot-book-imbalance.ts`): Order book depth imbalance detection
- **VolatilityMismatchModule** (`volatility-mismatch.ts`): Realized vs implied vol spread
- **WhaleFlowModule** (`whale-flow.ts`): Large transaction detection and classification

CRYPTEX is the 11th signal module, added to SPEED mode pipeline with 10-min time decay.

### V2.8 Cost Optimization & Smart Order Routing

**Files:** `packages/tradex/src/strategies/`

Four execution strategies:

- **SmartRouter** (`smart-router.ts`): Compares effective price across Kalshi & Polymarket. Factors: platform price, fee rate, liquidity, slippage estimate. Slippage model: 0.1% per 1% of liquidity taken (capped 2%).
- **IcebergOrderer** (`iceberg.ts`): Splits large orders into smaller chunks to minimize market impact
- **MakerFirstStrategy** (`maker-first.ts`): Posts limit orders first, falls back to taker after timeout
- **MarketMakerStrategy** (`market-maker.ts`): Two-sided quoting for capturing spread

### V2.9 WebSocket Auth Ticket System

**File:** `apps/api/src/plugins/websocket.ts`

Replaces raw API key in WebSocket URL with a short-lived ticket:

1. `POST /api/v1/auth/ws-ticket` — exchange API key for 60-second single-use ticket (32-byte randomBytes hex)
2. `GET /ws?ticket=<ticket>` — connect with single-use enforcement + expiry validation
3. Legacy fallback: `?apiKey=xxx` still works but is deprecated
4. Auto-cleanup of expired tickets every 60 seconds

### V2.10 Auto-Restart Wrapper & Worker Memory Configuration

**File:** `apps/api/scripts/start-worker.sh`

Bash script with infinite loop restart logic and 5-second delay on crash. Usage: `./apps/api/scripts/start-worker.sh`

**Memory configuration:**
- `NODE_OPTIONS="--max-old-space-size=2048"` — 2 GB heap limit for the worker process
- `MAX_MARKETS = 15` in `signal-pipeline.job.ts` — reduced from 25 to stay within memory budget with concurrent LLM module execution
- Analysis worker lock duration: 30 min (`lockDuration: 1800000`) with per-market lock extension to handle long LLM pipeline runs
- Pipeline pre-filters extreme-price markets (< 5¢ or > 95¢) to avoid wasting LLM calls on unanalyzable markets

### V2.11 Rate Limiting & Security

- **Fastify rate-limit plugin**: 100 requests per minute per API key, keyed by X-API-KEY header or IP address
- **SHA-256 hashed cache keys** for sensitive data in Redis

### V2.12 Extended Data Sources

**Files:** `apps/api/src/services/data-sources/`

- `binance-ws.ts` — Binance WebSocket price feed
- `fedwatch.ts` — CME FedWatch probability data
- `fred.ts` — Federal Reserve Economic Data (FRED) API
- `congress.ts` — Congressional activity tracker
- `polling.ts` — Political polling aggregation

### V2.13 Additional Services

- **Historical Ingest** (`jobs/historical-ingest.job.ts`): Backfills market data for new markets
- **Retroactive Backtest** (`services/retroactive-backtest.ts`): Tests strategies against historical data
- **Event-Driven Ingestion** (`services/event-driven-ingestion.ts`): Real-time catalyst detection and market re-analysis
- **Crypto Price Service** (`services/crypto-price.ts`): Cross-exchange price aggregation

#### Testing Requirements (TRADEX)

| Test | Acceptance Criteria |
|------|-------------------|
| Preflight — all gates pass | Given valid edge within all limits, preflight returns `{ pass: true }` |
| Preflight — over limit | Given trade exceeding max per trade, preflight returns `{ pass: false, failedGate: 'RISK_GATE' }` |
| Preflight — insufficient balance | Given balance < trade size, preflight returns `{ pass: false, failedGate: 'BALANCE_CHECK' }` |
| Preflight — edge evaporated | Given re-fetched price with no edge, returns `{ pass: false, failedGate: 'EDGE_VALID' }` |
| Fee calculation (Kalshi) | `calculateFee(10, 0.55)` = `ceil(0.07 × 10 × 0.55 × 0.45)` = correct value |
| Risk limits — hard ceiling | Cannot set max per trade above $500 via API or UI |
| Circuit breaker | After 3 consecutive failures, executor pauses for 15 min |
| Kill switch | Setting `TRADEX_ENABLED=false` prevents all execution |
| Execution mode routing | ARBEX signal → FAST_EXEC, DOMEX signal → SLOW_EXEC |
| AuditLog | Changing a risk limit creates AuditLog entry with previous and new values |
| KalshiExecutor (demo) | Places and cancels order on Kalshi demo API |

---

**Phase 6 additions become:** implement `ManifoldAdapter` and `MetaculusAdapter` — now trivial.

---

## Appendix: Shared Type Definitions (`packages/shared/src/types.ts`)

```typescript
// ── Module IDs ──
export const MODULE_IDS = ['COGEX', 'LEGEX', 'DOMEX', 'SIGINT', 'NEXUS', 'ALTEX', 'FLOWEX', 'REFLEX'] as const;
export type ModuleId = typeof MODULE_IDS[number];

// ── Signal Output (all modules) ──
export interface SignalOutput {
  moduleId: ModuleId;
  marketId: string;
  probability: number;
  confidence: number;
  reasoning: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
  expiresAt: Date;
}

// ── Edge Output (CORTEX) ──
export interface EdgeOutput {
  marketId: string;
  cortexProbability: number;
  marketPrice: number;
  edgeMagnitude: number;
  edgeDirection: 'BUY_YES' | 'BUY_NO';
  confidence: number;
  expectedValue: number;
  signals: SignalContribution[];
  kellySize: number;
  isActionable: boolean;
  conflictFlag: boolean;
  timestamp: Date;
}

export interface SignalContribution {
  moduleId: ModuleId;
  probability: number;
  confidence: number;
  weight: number;
  reasoning: string;
}

// ── Time Decay Constants ──
export const MODULE_HALF_LIVES: Record<ModuleId, number> = {
  COGEX: 30,      // minutes
  FLOWEX: 30,
  LEGEX: 360,     // 6 hours
  DOMEX: 360,
  ALTEX: 360,
  REFLEX: 360,
  SIGINT: 120,    // 2 hours
  NEXUS: 120,
};

// ── CORTEX Default Weights ──
export const DEFAULT_WEIGHTS: Record<ModuleId, Record<string, number>> = {
  COGEX:  { POLITICS: 0.15, FINANCE: 0.15, CRYPTO: 0.10, SCIENCE: 0.15, OTHER: 0.15 },
  LEGEX:  { POLITICS: 0.15, FINANCE: 0.10, CRYPTO: 0.10, SCIENCE: 0.15, OTHER: 0.15 },
  DOMEX:  { POLITICS: 0.20, FINANCE: 0.20, CRYPTO: 0.25, SCIENCE: 0.15, OTHER: 0.15 },
  SIGINT: { POLITICS: 0.05, FINANCE: 0.10, CRYPTO: 0.15, SCIENCE: 0.05, OTHER: 0.05 },
  NEXUS:  { POLITICS: 0.10, FINANCE: 0.15, CRYPTO: 0.10, SCIENCE: 0.10, OTHER: 0.10 },
  ALTEX:  { POLITICS: 0.15, FINANCE: 0.10, CRYPTO: 0.10, SCIENCE: 0.15, OTHER: 0.15 },
  FLOWEX: { POLITICS: 0.10, FINANCE: 0.10, CRYPTO: 0.10, SCIENCE: 0.10, OTHER: 0.15 },
  REFLEX: { POLITICS: 0.10, FINANCE: 0.10, CRYPTO: 0.10, SCIENCE: 0.15, OTHER: 0.10 },
};

// ── Alert Types ──
export interface AlertRecord {
  id: string;
  type: 'NEW_EDGE' | 'SMART_MONEY_MOVE' | 'PRICE_SPIKE' | 'MODULE_FAILURE' | 'CAUSAL_INCONSISTENCY' | 'EDGE_EVAPORATION';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  marketId: string | null;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  acknowledged: boolean;
  snoozedUntil: string | null;
  createdAt: string;
}

// ── WebSocket Event Types ──
export type WsEvent =
  | { event: 'edge:new'; data: EdgeOutput }
  | { event: 'edge:update'; data: EdgeOutput }
  | { event: 'edge:evaporate'; data: { marketId: string } }
  | { event: 'alert:new'; data: AlertRecord }
  | { event: 'price:update'; data: { marketId: string; yesPrice: number; change: number } }
  | { event: 'sigint:smartmove'; data: { walletAddress: string; marketId: string; direction: string; amount: number } }
  | { event: 'system:moduleStatus'; data: { moduleId: ModuleId; status: 'healthy' | 'degraded' | 'down' } };
```

### V2.14 Paper Trading & Orderbook Fixes (2026-03-26)

**Issues identified and fixed:**

1. **Paper position jobs not running:** `paper-position-update` and `position-reconciliation` jobs were defined in `queue.ts` and `workers.ts` but were never registered in Redis because the worker hadn't been restarted since they were added. **Fix:** Worker restart required after deployment to register all new job schedulers.

2. **Stale paper positions cleared:** All old paper positions created under the previous system (no fees, 0.5% threshold, probability guessing) were deleted to prevent learning loop contamination. New positions will be created under the fee-adjusted system (3% EV threshold, Kalshi fee model).

3. **Cent symbol encoding bug:** `\u00a2` used in JSX text content (outside `{}` expressions) in `Backtest.tsx` rendered as literal `\u00a2` instead of ¢. **Fix:** Changed to `{'\u00a2'}` (inside JS expression) so the Unicode escape is properly interpreted.

4. **Clickable paper positions:** Paper position rows in both `Backtest.tsx` (live performance table) and `Portfolio.tsx` now navigate to the Signal Viewer (`/markets/:id/signals`) on click. The `/backtest/live-performance` API now returns `marketId` in position data.

5. **Orderbook sync silent failures:** The `orderbook-sync` job was registered and running but silently failing for all markets (errors caught per-market, job completes with 0 synced). Only 500 snapshots exist from a single 8-minute window. **Fix:** Added warn-level logging when synced count is 0, improved per-market error logging with platform and error message details. Root cause likely platform API auth/connectivity — check logs after worker restart.

6. **Job handler return values:** `handleOrderBookSync`, `handlePaperPositionUpdate`, and `handlePositionReconciliation` now return structured results visible in BullMQ job data for debugging.

### V2.15 Platform-Native Category Classification (2026-03-26)

**File:** `apps/api/src/services/category-detector.ts`

**Problem:** `detectCategory()` used keyword regex matching as the primary category signal. Both Kalshi and Polymarket provide category metadata in their API responses, but it was either passed incorrectly (Kalshi: `event_ticker` instead of `event.category`) or not captured at all (Polymarket: `category` field existed but wasn't in the interface).

**Fix — 3-tier priority:**
1. **Platform-provided category** (new primary): Both platforms' category strings are mapped to `MarketCategory` via `PLATFORM_CATEGORY_MAP`. Kalshi event categories (`Elections`, `Sports`, `Financials`, etc.) and Polymarket categories (`US-current-affairs`, `Sports`, `Crypto`, `Pop-Culture`, etc.) are all mapped.
2. **Keyword regex matching** (fallback): Only used when platform category is missing or unmapped. Enhanced with European football leagues (EPL, La Liga, Champions League, Serie A, Bundesliga), team names (Manchester United, Barcelona, Bayern, etc.), and sports award patterns (MVP, Rookie of the Year, draft pick).
3. **`reclassifyMarket()`** (secondary fallback): Catches remaining `OTHER` markets via more aggressive patterns.

**Changes:**
- `category-detector.ts`: Replaced `eventTicker` parameter with `platformCategory`. Added `PLATFORM_CATEGORY_MAP` lookup table covering both Kalshi and Polymarket category strings.
- `kalshi-client.ts`: Changed `normalizeMarket()` to pass `k.category` (event category from API) instead of `k.event_ticker`.
- `polymarket-client.ts`: Added `category` field to `PolymarketGammaMarket` interface. Pass `gamma.category` to `detectCategory()`.

**Verification:** "Manchester United finish in top 4 of EPL" → `SPORTS` (was potentially `OTHER` or `POLITICS` before).

**priceLevel in FeatureModel:** Intentionally kept with `weight=0` in `packages/cortex/src/feature-model.ts`. It's stored in signal metadata for observability but excluded from `flattenFeatures()` model input. This prevents price anchoring bias: if market price influenced the probability model, predictions would converge to market price and edge would always be ~0. This is by design, not a bug.

### V2.16 Market Recategorization & Confidence Gate (2026-03-26)

**1. Bulk recategorization of existing markets:**

Added `POST /system/recategorize-markets` endpoint that re-runs `detectCategory()` + `reclassifyMarket()` on all markets in the database. First run: **454 markets recategorized** out of 11,541 total. Largest change: 346 markets moved from POLITICS → SPORTS (European football, NBA awards, and team-name markets that the old regex missed).

**2. Minimum confidence for actionability:**

**File:** `apps/api/src/engine/cortex.ts`

Added 4th gate to the actionability check: `confidence >= MIN_CONFIDENCE_FOR_ACTIONABLE` (20%). An 11% confidence signal is noise — the system was entering paper positions on low-conviction edges that added variance without signal.

**Constant:** `MIN_CONFIDENCE_FOR_ACTIONABLE = 0.20` in `packages/shared/src/constants.ts`

**Full actionability gate (all 4 must pass):**
1. EV ≥ 3% (`EDGE_ACTIONABILITY_THRESHOLD`)
2. Confidence ≥ 20% (`MIN_CONFIDENCE_FOR_ACTIONABLE`)
3. ≥ 2 modules contributed probability signals
4. ≥ 1 LLM module contributed (LEGEX/DOMEX/ALTEX/REFLEX)

The `buildActionabilitySummary()` now reports confidence failures explicitly (e.g., "confidence 11% below 20% minimum").

**3. Low-confidence paper positions purged:** 10 positions with confidence < 20% deleted. 37 positions with ≥ 20% confidence retained.

### V2.17 SPEEDEX Rewrite & Speed Pipeline Paper Positions (2026-03-26)

**Problem:** SPEEDEX had 0 signals because:
1. Its `parseThreshold()` regex looked for `"BTC > $100K"` style titles but Kalshi crypto titles are `"Bitcoin price range on Mar 26, 2026?"` — no match
2. 97% of Kalshi crypto contracts are BRACKET type (2,389 out of 2,449 expiring in 24h) but SPEEDEX only handled simple above/below (FLOOR) logic
3. The proper bracket/floor math already existed in `crypto-price.ts` (`calculateBracketImpliedProb`, `parseKalshiCryptoTicker`) but SPEEDEX didn't use it
4. Speed pipeline created raw signals but never synthesized edges or entered paper positions

**Fix — SPEEDEX rewrite** (`apps/api/src/modules/speedex.ts`):
- Uses `parseKalshiCryptoTicker()` to parse contract type, strike, and bracket width from `platformContractId`
- BRACKET contracts: `P(bracket) = N(d_upper) - N(d_lower)` via `calculateBracketImpliedProb()` with realized vol
- FLOOR contracts: `P(above) = N(d)` via `calculateSpotImpliedProb()` with realized vol
- Spot prices from CoinGecko (30s cache) or Binance WebSocket (ms latency)
- Edge = vol-implied probability vs market price. Minimum 3% divergence + 1.5x fee coverage
- Confidence boosted for near-expiry contracts (<1h: 1.5x, <4h: 1.2x)
- Zero LLM calls — pure Black-Scholes math

**Fix — Speed pipeline paper positions** (`apps/api/src/jobs/speed-pipeline.job.ts`):
- After persisting SPEEDEX signals, checks if edge meets actionability thresholds (EV ≥ 3%, confidence ≥ 20%)
- Creates paper positions directly from SPEEDEX edges — no CORTEX synthesis needed, no LLM module requirement
- This is the ONLY pipeline that creates positions from pure-math signals
- Logs contract type (BRACKET/FLOOR) and edge details on position entry

**Speed pipeline passes `platformContractId`** in contract data so SPEEDEX can parse the ticker format.

**Key math:**
- BTC hourly realized vol ≈ 0.6% (annualized ~57%)
- Vol scales by √T for the relevant window
- Bracket probability for $500 BTC bracket centered on spot at 1h ≈ 30%
- Off-center brackets drop rapidly — this is correct, not mispricing

**Zero Claude calls verified:** Neither `speed-pipeline.job.ts` nor `speedex.ts` import or call any LLM services.

**Price fallback for crypto brackets:** Most Kalshi crypto bracket contracts have `lastPrice = null` (no trades, only asks). Speed pipeline now uses fallback chain: `lastPrice ?? midpoint(bestBid, bestAsk) ?? bestAsk ?? bestBid`. Injects resolved price into contract data so SPEEDEX sees it.

**First live run results:** 50 markets → 44 filtered (price <5¢ or >95¢ — correct for off-center brackets) → 6 processed → 12 signals (6 SPEEDEX + 6 FLOWEX) → 6 paper positions entered. All in 320ms.

### V2.18 Paper Trading Quality Fixes (2026-03-26)

**1. Direction-aware P&L calculation** (`paper-trader.ts`):
- BUY_YES: P&L = (currentPrice - entryPrice) × kellySize — profit when YES price goes UP
- BUY_NO: P&L = (entryPrice - currentPrice) × kellySize — profit when YES price goes DOWN
- Previous bug: `updatePaperPositions()` skipped all crypto brackets because `lastPrice = null`
- Fix: Added `resolveContractPrice()` fallback chain for P&L updates too (same as speed pipeline)

**2. Position display names** (`paper-trader.ts` + `backtest.ts`):
- Added `buildPositionDisplayName()`: parses `platformContractId` to show "BTC $67,050-$67,550 MAR 26 9PM" instead of generic "Bitcoin price range on Mar 26, 2026?"
- Backtest API endpoint includes contract's `platformContractId` and maps through display name builder
- Handles BRACKET (range), FLOOR (above/below), and non-crypto markets (passthrough)

**3. Speed pipeline guards** (`speed-pipeline.job.ts`):
- **Min 30 minutes to expiry** (`MIN_HOURS_TO_EXPIRY = 0.5`): No last-second trades on expiring contracts
- **Min $100 contract volume** (`MIN_CRYPTO_VOLUME = 100`): Skip illiquid brackets
- **Max 3 positions per asset per date** (`MAX_POSITIONS_PER_ASSET_DATE = 3`): Prevents over-concentration (was 6 BTC brackets in one cycle)
- `checkConcentrationLimit()` queries open positions grouped by asset + expiry date

**4. Expired position handling** (`position-sync.ts` + `paper-trader.ts`):
- Added expired market case in `reconcilePositions()`: if `closesAt < now` but no `resolution`, close with final P&L estimate
- Also added in `updatePaperPositions()` auto-close for expired markets
- Uses price fallback chain for final price when `lastPrice` is null

**5. Vol model validation logging** (`speedex.ts`):
- Logs one complete SPEEDEX example per worker session with all model inputs/outputs:
  spot price, bracket [low, high], hours to expiry, hourly vol (0.6%), period sigma, model probability, market price, calculated edge, fee estimate
- Tagged with `validation: 'SPEEDEX_VOL_MODEL'` for easy grep

### V2.19 Overnight Research Stability (2026-03-26 PM)

**Goal:** Stabilize the RESEARCH pipeline for clean overnight paper trade data collection.

**1. SPORTS-EDGE Safety** (`base-agent.ts`, `sports-edge.ts`):
- Added `requireContext` option to `DomexAgentOptions`. When true, agent returns `null` if context provider returns empty/no data.
- SPORTS-EDGE sets `requireContext: true` — LLM never runs without real odds data from The Odds API.
- `ODDS_API_KEY` confirmed empty in `.env` — SPORTS-EDGE is safely disabled until key is configured.
- Prevents hallucinated features (e.g. "62% Schauffele") from producing false actionable edges.

**2. Actionability Gates** (verified, already implemented in `cortex.ts`):
- EV >= 3% (covers Kalshi round-trip fees)
- Confidence >= 20% (`MIN_CONFIDENCE_FOR_ACTIONABLE`)
- At least 2 modules contributed probability signals
- At least 1 LLM module (LEGEX/DOMEX/ALTEX/REFLEX) — pure stats can't analyze events

**3. Category Re-map** (one-time, via `POST /system/recategorize-markets`):
- 595 of 12,628 markets updated. Key: 32 POLITICS→SPORTS, 56 CULTURE→SPORTS.
- Sports markets (European football, NBA/NFL props) no longer misrouted to GEO-INTEL/LEGAL-EAGLE.

**4. Speed Pipeline Paper Trades Disabled** (`speed-pipeline.job.ts`):
- Crypto bracket data quality unreliable — paper trades from speed pipeline temporarily stopped.
- Pipeline still runs every 30s for monitoring/signals (SPEEDEX + FLOWEX).
- Research pipeline handles all paper trade creation until crypto data is validated.

**5. LLM Cost Controls** (`llm-budget-tracker.ts`, `.env`):
- `LLM_DAILY_BUDGET` lowered from $25 to $5.
- `HARD_LIMIT` lowered from $20 to $5 — no exceptions.
- Previous day: $25.47 (14K SCREEN_MARKET calls = $20.87). New budget enforces $5/day cap.
- Adaptive rate limiting: 100 calls/hr normal → 50 at 50% budget → 10 at 80%.

**6. Worker restart:** All RESEARCH modules confirmed online (COGEX, FLOWEX, LEGEX, DOMEX, ALTEX, REFLEX). Speed pipeline running with 0 paper positions (disabled). Paper-position-update and position-reconciliation jobs verified running every 5 minutes.

### V2.20 SPORTS-EDGE: The Odds API + ESPN Data + Bookmaker Baseline (2026-03-26 PM)

**Problem:** SPORTS-EDGE was returning null because `ODDS_API_KEY` was empty. Even when configured, the agent had no injury data, standings, or team form — just bookmaker odds. And the feature model treated all features equally instead of anchoring to bookmaker consensus.

**1. The Odds API Integration** (`odds-api.ts`):
- Configured `ODDS_API_KEY` in `.env` (free tier: 500 req/month).
- Fixed response field mapping: API returns `home_team`/`away_team` (snake_case), not `homeTeam` (camelCase).
- Tiered in-memory caching based on time to event:
  - >7 days out: 6 hours (futures — odds barely move)
  - 1-7 days out: 2 hours (odds start moving as game approaches)
  - <24 hours: 15 minutes (game day — injuries, line movement, sharp money)
  - Live/in-progress: 2 minutes
- Monthly usage tracked in `SystemConfig` key `odds_api_monthly_usage` (calls, remaining, month). Warns at ≤50 remaining. Exposed via `GET /system/odds-api-usage`.
- Added team-name-based sport detection: if title contains "Hornets" → `basketball_nba`, even without explicit "NBA" keyword. Covers 120+ team names across NBA, NFL, MLB, NHL.
- Added over/under data extraction alongside moneyline and spread.

**2. ESPN Public API Integration** (NEW: `espn-data.ts`):
- No API key required — free public endpoints.
- Three data sources:
  - **Injuries**: `site.api.espn.com/apis/site/v2/sports/{sport}/{league}/injuries` — key player status (Out, Day-To-Day, Questionable)
  - **Standings**: `site.api.espn.com/apis/site/v2/sports/{sport}/{league}/standings` — W-L record, home/away splits, streak
  - **Team Schedule**: `site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams/{id}/schedule` — last 10 game results, rest days, recent form percentage
- Static team ID maps for NBA (30), NFL (32), MLB (30), NHL (32) teams.
- In-memory cache: 2h TTL for injuries, 12h for standings, 2h for schedule.
- Team-name-based sport detection matching same pattern as odds-api.

**3. SPORTS-EDGE Context Provider** (`sports-edge.ts`):
- Calls both `getSportsOdds()` and `getEspnData()` in parallel via `Promise.allSettled`.
- Merges context strings from both sources.
- `requireContext: true` passes if EITHER source returns data (ESPN alone is sufficient).

**4. Bookmaker-Implied Probability as Baseline** (`feature-model.ts`, `domex.ts`, prompt):
- Added `bookmakerImpliedProb` to `SportsEdgeFeatures` interface.
- Default weight: `3.0` (highest sports feature — this is the anchor).
- Other sports weights reduced to act as adjustments around the bookmaker line:
  - `homeAway`: 0.15 → 0.10 (bookmaker already prices home advantage)
  - `recentForm`: 0.8 → 0.5 (bookmaker already factors form)
  - `injuryImpact`: -0.6 → -0.4 (bookmakers react fast to injury news)
  - `lineMovement`: 0.4 → 0.3
  - `headToHeadRecord`: 0.3 → 0.2
- When no odds available, `bookmakerImpliedProb` defaults to `NaN` → silently skipped by `flattenFeatures` (no bias).
- Prompt instructs agent to extract implied probability from moneyline odds: e.g., DraftKings +300 → 100/(300+100) = 0.25.

**5. SPORTS-EDGE Prompt Update** (`domex-sports-edge.md`):
- Added `bookmakerImpliedProb` as most important required feature.
- Added instructions to use ESPN data for `restDays`, `injuryImpact`, `recentFormLast10`.
- Added base rate note: "Bookmaker lines are well-calibrated — use them as your baseline."

**6. Verified End-to-End:**
- Test: "Will the Charlotte Hornets beat the New York Knicks?"
- Odds API: Hornets -6500 (98.5% implied), Knicks +1725, spread -11.5
- ESPN: Hornets 38-34 record, 7-3 last 10, 2 rest days, McNeeley/Salaun out
- Agent extracted: `bookmakerImpliedProb: 0.985`, `recentFormLast10: 0.7`, `injuryImpact: 0.08`, `homeAway: 1`
- `dataSourcesUsed`: The Odds API, ESPN Schedule, ESPN Injury Report

### V2.21 Category Detection: High-Confidence Keyword Overrides (2026-03-26 PM)

**Problem:** "Chelsea Clinton win 2028 Democratic presidential nomination?" tagged SPORTS because `chelsea` matched the Chelsea FC regex before political keywords were checked. "GTA VI" markets tagged SPORTS via cascading misclassification. Root cause: sports team names (Chelsea, Cardinals, Kings, Panthers) are also common words/names, and sports patterns were checked before politics.

**Fix: Three-tier detection priority** (`category-detector.ts`, `category-classifier.ts`):

1. **Tier 0 — High-confidence keyword overrides** (NEW): Political keywords (`election`, `president`, `nomination`, `democrat`, `republican`, `ceasefire`, `sanctions`, etc.), finance keywords (`fed`, `fomc`, `tariff`, `gdp`), and crypto keywords (`bitcoin`, `ethereum`, `blockchain`) override ALL other signals including platform category. These terms are never ambiguous.

2. **Tier 1 — Platform category**: Kalshi `event.category` / Polymarket `market.category` mapped via `PLATFORM_CATEGORY_MAP`. Preserved unless overridden by Tier 0.

3. **Tier 2 — Keyword fallback**: Sports league names (NBA, NFL, EPL), game mechanics (touchdowns, rebounds), team names. Sports team name matching now runs AFTER politics/finance/crypto overrides, preventing false positives.

**Additional fixes:**
- Added CULTURE patterns for games/entertainment (`gta`, `video game`, `playstation`, `released before`).
- Added SPORTS recovery in `reclassifyMarket`: if market has unambiguous league names (NBA, NFL, etc.) but is tagged wrong (e.g. POLITICS from a bad run), correct it. Only fires on league names, NOT ambiguous team names.
- Fixed `POST /system/recategorize-markets`: now uses `reclassifyMarket(title, currentCategory)` instead of `detectCategory(title)` without platform category. Preserves platform-assigned categories.
- Recategorization results: 850 SPORTS→POLITICS (Chelsea Clinton, etc.), 572 POLITICS→SPORTS recovered (NBA MVP, etc.), 4 SPORTS→CULTURE (GTA VI, Rihanna).

**Test results (13/13 pass):**
- "Chelsea Clinton Democratic presidential nomination" → POLITICS
- "Chelsea vs Arsenal EPL match" → SPORTS
- "Russia-Ukraine Ceasefire before GTA VI?" → POLITICS
- "New Rihanna Album before GTA VI?" → CULTURE
- "Will LeBron James win the 2028 US Presidential Election?" → POLITICS
- "Will LeBron James win the 2025-2026 NBA MVP?" → SPORTS

### V2.22 Store rawPlatformCategory for Reliable Recategorization (2026-03-26 PM)

**Problem:** Recategorization couldn't re-apply platform categories because we didn't store the raw category string from Kalshi/Polymarket. Markets that lost their platform-assigned category (e.g., Kalshi `"crypto"`) during a recategorize run couldn't be recovered without re-fetching from the API.

**Fix:** Added `rawPlatformCategory String?` column to the `Market` Prisma model. Stores the exact category string from the platform API (e.g., `"elections"`, `"crypto"`, `"us-current-affairs"`, `"pop-culture"`).

**Changes:**
- `packages/db/prisma/schema.prisma`: Added `rawPlatformCategory String?` to Market model
- `packages/shared/src/platform-adapter.ts`: Added `rawPlatformCategory?: string | null` to NormalizedMarket interface
- `apps/api/src/services/kalshi-client.ts`: Passes `k.category` as `rawPlatformCategory`
- `apps/api/src/services/polymarket-client.ts`: Passes `gamma.category` as `rawPlatformCategory`
- `apps/api/src/services/market-sync.ts`: Stores `rawPlatformCategory` in create/update
- `apps/api/src/routes/system.ts`: `POST /system/recategorize-markets` now uses stored `rawPlatformCategory` with `detectCategory(title, description, rawPlatformCategory)` instead of keyword-only detection
- Migration: `prisma db push` added nullable column (no data loss)

**Data flow:** Column starts null for all 13,171 existing markets. Next market-sync (every 5 min) populates it as markets are upserted from Kalshi/Polymarket. Future recategorization runs will always have the platform's original category available.

### V2.23 System Verification — Paper Trade Run Readiness (2026-03-27 PM)

**Verification scope:** Full system health check before 24-48h overnight paper trade collection run.

**ESPN integration:** `espn-data.ts` confirmed operational — injuries (28 NBA teams), standings, team schedules for NBA/NFL/MLB/NHL + 6 soccer leagues. Wired into SPORTS-EDGE alongside The Odds API. Both data sources confirmed flowing through worker logs.

**Module health (all producing signals in last 24h):**
| Module | Signals (24h) | Last Signal | Status |
|--------|--------------|-------------|--------|
| FLOWEX | 6,675 | 42m ago | ✅ UP |
| SPEEDEX | 6,572 | 42m ago | ✅ UP |
| ARBEX | 672 | 25h ago | ✅ UP (60s cycle) |
| COGEX | 186 | 9m ago | ✅ UP |
| LEGEX | 146 | 22m ago | ✅ UP |
| DOMEX | 125 | 23m ago | ✅ UP |
| ALTEX | 64 | 22m ago | ✅ UP |
| REFLEX | 30 | 22m ago | ✅ UP |

**24h stats:** 13,352 signals → 488 edges → 267 actionable → 12 paper trades.

**Known issues:**
- LLM cost $24.47/day — exceeds $5/day budget target. Investigate whether HARD_LIMIT is enforcing or just logging.
- ~~No `start-worker.sh` auto-restart script~~ — FIXED: `start-worker.sh` added with 5s cooldown, 60s backoff after 10 rapid restarts.

### V2.24 Fuku Predictions API Integration — Data-First Sports Analysis (2026-03-27 PM)

**Problem:** SPORTS-EDGE was using LLM-based feature extraction for sports markets — expensive and less accurate than structured numeric data. The Odds API provides odds but not predictions, and has a 500/month request limit.

**Solution:** Integrated Fuku Predictions API (`cbb-predictions-api-nzpk.onrender.com`) as the primary data source for CBB, NBA, NHL, and Soccer. Fuku aggregates 20+ data sources and provides pre-computed predictions, team metrics, and market edges — structured numeric features that bypass the LLM entirely.

**Architecture — priority chain:**
1. **Fuku (data passthrough):** For CBB/NBA/NHL/Soccer, fetch pre-computed predictions. If Fuku has a matching game, return structured features directly — **no LLM call, zero cost**.
2. **Odds API + ESPN (LLM fallback):** For sports Fuku doesn't cover (golf, tennis, MMA, etc.), fall back to existing flow: fetch odds/injuries → LLM feature extraction.

**New files:**
- `apps/api/src/services/data-sources/fuku-data.ts` — Fuku API client with:
  - Sport detection (CBB, NBA, NHL, Soccer, with team name fallback)
  - Tiered caching: predictions 30min, teams/rankings 6hr
  - Team matching (normalized names, partial/last-word matching)
  - Structured feature extraction: `FukuFeatures` → `DomexAgentResult`
  - Health check on startup
  - 15s timeout (Render free tier)

**Modified files:**
- `apps/api/src/modules/domex-agents/sports-edge.ts` — Complete rewrite:
  - No longer uses `createDomexAgent` directly — custom `DomexAgent` implementation
  - Tries Fuku first; if features returned, converts to `DomexAgentResult` without LLM
  - Falls back to `llmFallbackAgent` (original Odds API + ESPN + LLM flow) when Fuku has no data
  - `requireContext: true` preserved on fallback — never hallucinates

**Feature mapping (Fuku → FeatureModel):**
| Feature | Source | Description |
|---------|--------|-------------|
| `projectedSpread` | Fuku model | Fuku's projected point spread |
| `spreadEdge` | Fuku - book | Difference from market spread |
| `projectedTotal` | Fuku model | Projected combined score |
| `totalEdge` | Fuku - book | Difference from market total |
| `offensiveEfficiencyDiff` | Team profiles | Home off rating - away off rating |
| `defensiveEfficiencyDiff` | Team profiles | Home def rating - away def rating |
| `tempoDiff` | Team profiles | Pace differential |
| `homeTeamRank` / `awayTeamRank` | Rankings | Composite team rank |
| `homeWinPct` / `awayWinPct` | Team profiles | Season win percentages |
| `homeNetRating` / `awayNetRating` | Team profiles | Net efficiency rating |
| `fukuDataPassthrough` | Marker | `true` when no LLM was used |

**Odds API preservation:** CBB/NBA/NHL/Soccer predictions now come from Fuku (free, unlimited). Odds API quota (500/month) reserved for uncovered sports only.

**Test results:**
- NBA Celtics vs Hawks: ✅ Fuku passthrough — Score 118.3-109, Spread +9.3, Ranks #3 vs #13
- CBB Duke vs St John's: ✅ Fuku passthrough — Spread -5.9, Book -6.5, Edge -0.6
- NHL Sabres vs Red Wings: ✅ Fuku passthrough — Spread +2.91, Total 6.2
- Golf (uncovered): ✅ null features → correct LLM fallback

### V2.25 MATCH vs FUTURES Market Type Detection — Fix Match-Odds-to-Futures Confusion (2026-03-27 PM)

**Problem:** SPORTS-EDGE/DOMEX produced a 92.6% probability signal for "Will Napoli win the 2025–26 Serie A league?" — a futures/outrights market. The signal was based on Napoli vs AC Milan single-match moneyline odds from The Odds API. Being favored to win one match does not mean 92.6% chance of winning the league title. CORTEX confidence was 17.9% (below 20% threshold) so no paper trade was created, but the signal polluted edge data.

**Root cause:** The Napoli signal was generated at 02:26 AM ET, before the Fuku integration was deployed at 12:11 PM ET. It used the old Odds API h2h flow, which matched Napoli's next match and treated match moneyline odds as league-winner probability.

**Fix — market type detection:** Added `detectSportsMarketType()` that classifies sports markets as MATCH or FUTURES before fetching any data:

- **FUTURES markets** (league winners, championships, MVPs, tournaments, playoffs, relegation): SPORTS-EDGE returns `null` immediately. Match odds are never appropriate for futures.
- **MATCH markets** (head-to-head games with "vs", "beat", "tonight"): Proceed normally with Fuku → Odds API fallback chain.
- **UNKNOWN markets** (ambiguous): If Fuku returns no match, returns null (conservative — avoids match-odds-to-futures confusion).

**FUTURES patterns detected:**
- League/championship: "win Serie A", "win the Premier League", "win NBA championship"
- Tournament/cup: "win Champions League", "win World Cup", "win March Madness"
- Awards: "MVP", "Ballon d'Or", "Cy Young", "Heisman"
- Season outcomes: "make the playoffs", "relegated", "finish top 4"
- Time-based: closesAt > 60 days out with no MATCH indicators

**dataSource tag:** All SPORTS-EDGE results now include `sportsDataSource` and `sportsMarketType` in features, enabling filtering of bad signals from training data:
- `fuku` — Fuku API match predictions (data passthrough, no LLM)
- `oddsapi-h2h` — The Odds API h2h match odds (LLM extraction)
- `futures-blocked` — Futures market returned null
- `no-data` — No data available

**Test results:**
- Napoli Serie A (FUTURES): ✅ null — blocked correctly
- Liverpool Champions League (FUTURES): ✅ null — blocked correctly
- Doncic NBA MVP (FUTURES): ✅ null — blocked correctly
- Celtics vs Hawks (MATCH): ✅ Fuku passthrough, spread +9.3, dataSource=fuku
- Tiger Woods Masters (FUTURES): ✅ null — blocked correctly

### V2.26 Clean Baseline Reset — Clear Pre-Fix Data (2026-03-27 PM)

**Problem:** The existing 14 paper positions, 1,328 edges, and 18,074 signals were generated before three critical fixes (Odds API key, Fuku integration, MATCH vs FUTURES detection). Data was contaminated with hallucinated SPORTS-EDGE signals and match-odds-to-futures confusion. 10 of 14 paper positions were on FUTURES markets that should never have had SPORTS-EDGE-sourced signals.

**Action:** Full data reset (archived counts first):
- Deleted: 14 paper positions, 1,328 edges, 18,074 signals, 257 alerts, 939,004 price snapshots
- Preserved: 18,603 markets, 37,206 contracts, all SystemConfig, all FeatureModel state
- Reset daily LLM budget counter to $0.00

**Post-reset state:**
- Dashboard Edges: 0 edges (clean)
- Dashboard Portfolio: $10,000 total, $0 deployed, 0 positions (clean)
- Dashboard Markets: 18,603 markets (preserved)
- Worker restarted, RESEARCH pipeline rebuilding signals from clean baseline with Fuku + futures detection

**Fresh signals will have:**
- `sportsDataSource` tag: `fuku`, `oddsapi-h2h`, `futures-blocked`, `no-data`
- `sportsMarketType` tag: `MATCH` or `FUTURES`
- FUTURES markets: SPORTS-EDGE blocked (no match-odds-to-futures confusion), but ALL other modules still process them
- Fuku data passthrough for CBB/NBA/NHL/Soccer matches (zero LLM cost)

### V2.27 Verified: FUTURES Markets Flow Correctly Through Full Pipeline (2026-03-27 PM)

**Concern:** The `detectSportsMarketType()` fix might block FUTURES sports markets from the entire pipeline, not just SPORTS-EDGE.

**Verification result: Pipeline is correct. No code changes needed.**

The architecture already handles this correctly because:

1. **SPORTS-EDGE is a sub-agent inside DOMEX**, not a standalone module. When SPORTS-EDGE returns null, DOMEX still runs its other agents (GEO-INTEL, FED-HAWK, etc.) and produces a DOMEX signal if any agent returns features. Only if ALL agents return null does DOMEX return null.

2. **Other modules (COGEX, FLOWEX, LEGEX, ALTEX, REFLEX) are independent** — they receive the market regardless of SPORTS-EDGE's result. SPORTS-EDGE returning null has zero impact on whether these modules process the market.

3. **CORTEX fusion filters out missing modules** — if a module returned null, it simply isn't included in the weighted average. The fusion proceeds with whatever signals exist.

4. **Multi-module requirement (2+ modules, 1+ LLM)** counts module-level signals, not agents. SPORTS-EDGE is inside DOMEX, so its null doesn't reduce the module count.

**Confirmed with live data after clean reset:**
- Champions League FUTURES markets: 6 signals from ALTEX + LEGEX (not SPORTS-EDGE)
- 3 SPORTS edges created: Arsenal CL 3.8%, PSG CL 3.4%, Real Madrid CL 0.2%
- Confidence appropriately low (5-6%) because fewer modules contributed
- SPORTS-EDGE correctly did not contaminate these with match odds

### V2.28 start-all.sh — Resilient Process Management (2026-03-27 PM)

**Problem:** API server and dashboard keep dying between Claude Code sessions. The worker survives because it has `start-worker.sh` with auto-restart, but the API server (started via Claude Preview) gets killed on session restart.

**Root cause:** API was managed by Claude Preview (`launch.json`), which sends SIGTERM when the preview server restarts. The worker survived because it runs via `start-worker.sh` (independent `nohup` process).

**Fix:** Created `start-all.sh` — a single script that starts and monitors all three services:

| Feature | Implementation |
|---------|---------------|
| Auto-restart on crash | Monitor loop checks process liveness every 5s, restarts dead processes |
| API health check | Curls `/api/v1/system/health` every 60s, restarts if unresponsive |
| Port conflict handling | Kills existing processes on ports 3001/5173 before starting |
| Clean shutdown | Traps SIGTERM/SIGINT/SIGHUP, kills all children |
| Logging | Separate log files: api.log, worker.log, dashboard.log, all.log |
| PID file | `/tmp/apex-all.pid` for easy `kill $(cat /tmp/apex-all.pid)` |
| Stale process cleanup | Kills existing worker/start-worker.sh before starting fresh |

**Usage:**
```bash
./start-all.sh              # foreground (Ctrl+C to stop all)
nohup ./start-all.sh &      # background (survives terminal close)
kill $(cat /tmp/apex-all.pid)  # stop all from another terminal
```

### V2.29 Fix Category Misclassification — "primary resolution source" False Positive (2026-03-27 PM)

**Problem:** 304 sports markets (Arsenal EPL, Schauffele Masters, Champions League, NBA MVP, etc.) were categorized as POLITICS instead of SPORTS. GEO-INTEL agent was firing on sports markets and explicitly saying "this market is incorrectly categorized."

**Root cause:** Polymarket's standard description template contains "The **primary** resolution source will be..." — and `POLITICS_OVERRIDE` contained `\bprimary\b` (intended for "political primary election"). Since `detectCategory()` runs keyword checks on `title + description`, the word "primary" in 960+ market descriptions triggered a false POLITICS classification.

**Fix (3 changes):**

1. **Removed standalone `\bprimary\b`** from `POLITICS_OVERRIDE` in both `category-detector.ts` and `category-classifier.ts`. Replaced with specific phrases: `primary election`, `republican primary`, `democratic primary`.

2. **Added `SPORTS_OVERRIDE` as Tier 0a** — checked on **title only** (not description) before politics/finance/crypto. Contains unambiguous league names: NBA, NFL, MLB, NHL, MLS, EPL, Premier League, Champions League, Europa League, La Liga, Serie A, Bundesliga, Ligue 1, World Cup, World Series, Super Bowl, Stanley Cup, March Madness, Masters Tournament, PGA Tour, UFC, F1, Grand Prix.

3. **Expanded Tier 2 sports fallback** — added 60+ NHL/NBA/NFL team names, plus missing terms: masters tournament, europa league, copa del rey, fa cup, ligue 1, copa america, ryder cup, f1, wimbledon, french open, australian open, ballon d'or, cy young, heisman, relegated, relegation, promotion.

**Recategorization result:** 420 markets updated:
- 304 POLITICS → SPORTS (the core fix)
- 33 POLITICS → CULTURE
- 70 POLITICS → OTHER
- 12 POLITICS → SCIENCE
- 1 POLITICS → CRYPTO

**Test results (14/14 pass):**
- Arsenal EPL → SPORTS ✅ (was POLITICS)
- Schauffele Masters → SPORTS ✅ (was POLITICS)
- Chelsea Clinton nomination → POLITICS ✅ (still correct)
- Texas Republican Primary → POLITICS ✅ (uses "republican primary" phrase)
- All other categories preserved ✅

### V2.30 Targeted Cleanup of Stale Signals on Recategorized Markets (2026-03-27 PM)

**Problem:** After recategorizing 304 POLITICS→SPORTS markets, old signals and edges generated under the wrong category were still in the database. GEO-INTEL signals on sports markets, wrong DOMEX agent routing, etc.

**Fix:** Targeted deletion — only cleared signals/edges/paper positions for the 13 recategorized SPORTS markets that had stale signals. All other markets' signals preserved.

**Deleted:** 68 signals, 96 edges, 2 paper positions (on the 13 recategorized markets)
**Preserved:** 2,607 signals, 4 edges, 2 paper positions (on non-recategorized markets)

**Verified:**
- Arsenal EPL: 0 signals ✅ (will regenerate with SPORTS-EDGE routing)
- Schauffele Masters: 0 signals ✅
- POLITICS signals preserved: 13 ✅ (Viktor Orbán, Texas Primary, etc.)
- SPORTS-EDGE correctly detecting FUTURES and returning null on recategorized markets ✅
- Other modules (ALTEX, LEGEX, COGEX) still processing these markets ✅

### V2.31 Fix Kelly Criterion + Fee-Adjusted EV (CRITICAL) (2026-03-27 PM)

**3 bugs found and fixed:**

**Bug 1 — Kelly used fabricated win probability (packages/cortex dead code):**
The `packages/cortex/src/opportunity-scoring.ts` file (not used in production, but exported) used `winProb = 0.5 + fusedConfidence * 0.3` — a made-up formula instead of the actual `fusedProbability` from CORTEX. Fixed to use `fusedProbability` directly.

**Bug 2 — BUY_NO Kelly used wrong probability (ALL THREE files):**
All three Kelly implementations (`packages/cortex`, `apps/api/src/engine/cortex.ts`, `apps/api/src/services/cortex`) used `p = fusedProbability` for both BUY_YES and BUY_NO. But for BUY_NO, `p` should be `1 - fusedProbability` (probability of NO — the outcome being bet on). This caused BUY_NO positions to be **3x oversized**.

Example: market at 0.70, CORTEX prob 0.60, BUY_NO direction:
- **Before:** `p = 0.60`, Kelly quarter = 10.7% → oversized
- **After:** `p = 0.40` (prob of NO), Kelly quarter = 3.6% → correct

BUY_YES and BUY_NO with symmetric 10% edges now produce identical Kelly fractions (3.6%).

**Bug 3 — EV not fee-adjusted (production cortex.ts):**
`expectedValue = edgeMagnitude × confidence` didn't deduct fees. Changed to `expectedValue = netEdge × confidence` where `netEdge = edgeMagnitude - estimatedFee`. Uses Kalshi worst-case fee (7% of profit) as conservative estimate.

**Files fixed:**
- `apps/api/src/engine/cortex.ts` — BUY_NO Kelly fix + fee-adjusted EV (production path)
- `packages/cortex/src/opportunity-scoring.ts` — fabricated winProb + BUY_NO + fee formula
- `apps/api/src/services/cortex/opportunity-scoring.ts` — BUY_NO Kelly fix

**Test results:**
- BUY_YES (p=0.40, market=0.30): Kelly 3.6% ✅
- BUY_NO (p_yes=0.60, market=0.70): Kelly 3.6% ✅ (was 10.7%)
- Symmetry check: both 3.6% ✅
- No-edge (p=market=0.50): Kelly 0% ✅
- Fee deduction: 10% edge at 0.30 → 5.1% net edge after 4.9% Kalshi fee ✅

### V2.32 FeatureModel: Train/Val Split, L2 Regularization, Timestamp Fix, Schema Versioning (2026-03-27 PM)

**4 bugs found and fixed in the learning pipeline:**

**Bug 1 — No train/validation split (overfitting guarantee):**
Model trained on ALL data and reported in-sample accuracy as the quality metric. `modelFactor = model.accuracy` directly scaled confidence, so an overfit model produced artificially high confidence. Fixed: 80/20 train/validation split. Reports `validationAccuracy`. Confidence uses validation accuracy, not training accuracy. Model rejected if validation accuracy < 55%.

**Bug 2 — No regularization (40+ features, sparse data):**
With 40+ features and potentially few resolved markets, logistic regression will overfit without regularization. Fixed: L2 (ridge) regularization with λ=0.1. Prevents any single feature weight from dominating.

**Bug 3 — daysToResolution from wrong timestamp:**
Computed from `market.createdAt` instead of `signal.createdAt`. At training time this produces a different value than at inference time, creating systematic feature mismatch. Fixed: now uses signal's `createdAt` in both the FeatureModel training data and calibration data.

**Bug 4 — No feature schema versioning:**
`Object.assign(fv, meta.featureVector)` merged old schema features with no versioning. As agents change schemas (Fuku integration, futures detection), old training data has mismatched features. Fixed: `FEATURE_SCHEMA_VERSION = 2` stamped on every DOMEX signal. Learning loop filters to only use current-version signals for training.

**Files changed:**
- `packages/cortex/src/feature-model.ts`: train/val split, L2 regularization, min 30 samples, validation accuracy, schema version export
- `packages/cortex/src/index.ts`: export `FEATURE_SCHEMA_VERSION`
- `apps/api/src/jobs/learning-loop.job.ts`: signal timestamp for daysToResolution, schema version filtering
- `apps/api/src/modules/domex.ts`: stamp `featureSchemaVersion` on signal metadata

**Safeguards added:**
| Safeguard | Threshold | Effect |
|-----------|-----------|--------|
| Minimum samples | 30 | Below this, model keeps default weights (no training) |
| Train/val split | 80/20 | Reports out-of-sample accuracy |
| Validation accuracy | ≥ 55% | Below this, trained model is rejected |
| L2 regularization | λ=0.1 | Prevents overfitting with sparse features |
| Schema versioning | v2 | Old signals excluded from training |

**Test results:**
- 25 samples < 30 min → model unchanged ✅
- 50 random samples → training 60%, validation 50% → model rejected (< 55%) ✅
- FEATURE_SCHEMA_VERSION = 2 ✅
