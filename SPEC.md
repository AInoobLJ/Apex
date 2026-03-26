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

#### CORTEX v1 (`apps/api/src/engine/cortex.ts`)

Phase 1 is a simple weighted average with only COGEX and FLOWEX:

```typescript
interface CortexInput {
  marketId: string;
  marketPrice: number;
  signals: SignalOutput[];  // from available modules
}

function synthesize(input: CortexInput): EdgeOutput {
  const { signals, marketPrice, marketId } = input;

  // Equal weights in v1 (no historical data yet)
  const totalWeight = signals.length;
  const weightedProb = signals.reduce((sum, s) => sum + s.probability, 0) / totalWeight;
  const avgConfidence = signals.reduce((sum, s) => sum + s.confidence, 0) / totalWeight;

  // Coverage factor: 2/8 modules = 0.25
  const coverageFactor = signals.length / 8;
  const confidence = Math.min(avgConfidence, coverageFactor);

  const edgeMagnitude = Math.abs(weightedProb - marketPrice);
  const edgeDirection = weightedProb > marketPrice ? 'BUY_YES' : 'BUY_NO';
  const expectedValue = edgeMagnitude * confidence;

  return {
    marketId,
    cortexProbability: weightedProb,
    marketPrice,
    edgeMagnitude,
    edgeDirection,
    confidence,
    expectedValue,
    signals: signals.map(s => ({
      moduleId: s.moduleId,
      probability: s.probability,
      confidence: s.confidence,
      weight: 1 / totalWeight,
      reasoning: s.reasoning,
    })),
    kellySize: 0,  // No portfolio manager in P1
    isActionable: expectedValue >= 0.03,
    conflictFlag: false,
    timestamp: new Date(),
  };
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

### 2.7 Kelly Criterion (`apps/api/src/services/portfolio-manager.ts`)

```typescript
interface KellyInput {
  cortexProbability: number;
  marketPrice: number;
  bankroll: number;
  kellyMultiplier: number;  // default 0.25
  existingPositions: Position[];
  concentrationLimits: ConcentrationLimits;
}

interface KellyOutput {
  recommendedSize: number;      // dollar amount
  kellyFraction: number;        // raw kelly fraction
  adjustedFraction: number;     // after multiplier + limits
  limitingFactor: string | null; // which limit was binding
}
```

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
LLM_DAILY_BUDGET=10.00             # daily Claude API budget in USD
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

**Market matcher:**
```typescript
interface MarketMatch {
  kalshiMarket: Market;
  polymarketMarket: Market;
  similarity: number;       // 0-1 title similarity
  confirmed: boolean;       // Claude confirmed same event
}

function findMatchingMarkets(
  kalshiMarkets: Market[],
  polymarketMarkets: Market[]
): Promise<MarketMatch[]>;
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

**Signal Fusion Engine** (`signal-fusion.ts`):
- Weighted combination of raw signals from 11 modules
- Per-module time decay constants (SPEEDEX 5min, CRYPTEX 10min, FLOWEX 30min, ARBEX 15min, etc.)
- Agreement scoring (0-1 disagreement metric)
- Module weights: SPEEDEX (0.20), ARBEX (0.18), COGEX (0.15), CRYPTEX (0.15), FLOWEX (0.12), LEGEX (0.10), DOMEX (0.10), ALTEX (0.08), SIGINT (0.08), REFLEX (0.05), NEXUS (0.04)

**Calibration Engine** (`calibration-memory.ts`):
- Per-module, per-category historical bias correction
- Tracks avgOverestimate, avgAbsError, Brier score
- Time-bucketed calibration (hours/days/weeks/months)
- Recalibrates weekly from resolved markets
- Requires 10+ samples before applying correction

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

### V2.6 Expanded DOMEX (8 Agents)

**Files:** `apps/api/src/modules/domex-agents/` + `apps/api/src/modules/domex.ts`

Expanded from 3 to 8 domain expert agents:

| Agent | Target Categories |
|-------|------------------|
| FedHawkAgent | FINANCE, POLITICS |
| GeoIntelAgent | POLITICS, CRYPTO |
| CryptoAlphaAgent | CRYPTO |
| SportsEdgeAgent | SPORTS |
| WeatherHawkAgent | SCIENCE, ENTERTAINMENT |
| LegalEagleAgent | POLITICS, FINANCE, CRYPTO |
| CorporateIntelAgent | FINANCE, ENTERTAINMENT |
| EntertainmentScoutAgent | ENTERTAINMENT, SPORTS |

All agents run in parallel on category-relevant markets. Trimmed-mean aggregation (drop highest/lowest if 3+). Flag agent disagreement >8% spread. Penalize confidence on disagreement.

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

### V2.10 Auto-Restart Wrapper

**File:** `apps/api/scripts/start-worker.sh`

Bash script with infinite loop restart logic and 5-second delay on crash. Usage: `./apps/api/scripts/start-worker.sh`

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
