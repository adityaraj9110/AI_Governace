# 🧠 AI FinOps & Governance Gateway

> Enterprise-grade AI cost governance, observability, and policy enforcement — from a unified gateway.

---

## Table of Contents

- [Overview](#overview)
- [Killer Combination (Enterprise Adoption)](#killer-combination)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [System Workflow](#system-workflow)
- [Roadmap](#roadmap)
  - [V1 — Foundation](#v1--foundation)
  - [V2 — Governance](#v2--governance)
  - [V3 — Agent & Tool Control](#v3--agent--tool-control)
  - [V4 — Intelligence & Optimization](#v4--intelligence--optimization)
- [Data Models](#data-models)
- [API Design](#api-design)
- [Infrastructure & Deployment](#infrastructure--deployment)
- [Security Model](#security-model)
- [Contributing](#contributing)

---

## Overview

This platform is an **AI Gateway + FinOps + Governance** layer that sits between your organization's applications/agents and all upstream LLM providers (OpenAI, Anthropic, Azure OpenAI, Gemini, Bedrock, etc.).

It provides:

- **Unified ingress** via a single API gateway (drop-in OpenAI-compatible)
- **Cost tracking & chargebacks** per user / team / project
- **Budget enforcement** with hard/soft limits
- **Prompt audit logs** for compliance & debugging
- **DLP & policy enforcement** before requests hit the model
- **Agent & tool registry** for agentic AI governance
- **Forecasting & optimization** using usage intelligence

---

## Killer Combination

For maximum enterprise adoption velocity, the following six capabilities form the irreducible core:

```
┌─────────────────────────────────────────────────────────────┐
│                  ENTERPRISE KILLER STACK                    │
├──────────────┬──────────────┬──────────────┬───────────────┤
│   Gateway    │   Budgets    │ Prompt Audit │ Agent Registry│
├──────────────┴──────────────┴──────────────┴───────────────┤
│                    DLP          +        Chargebacks        │
└─────────────────────────────────────────────────────────────┘
```

| Capability         | Why It Matters                                                   |
| ------------------ | ---------------------------------------------------------------- |
| **Gateway**        | Single pane of glass — all AI traffic flows through one point    |
| **Budgets**        | Finance teams get control; prevents runaway spend                |
| **Prompt Audit**   | Compliance & security teams can investigate any interaction      |
| **Agent Registry** | Governs agentic workflows — who launched what, with what tools   |
| **DLP**            | Prevents sensitive data leakage to external LLM providers        |
| **Chargebacks**    | Enables per-team / per-project cost allocation for P&L reporting |

---

## Tech Stack

### Backend

| Layer                | Technology                        | Rationale                                                            |
| -------------------- | --------------------------------- | -------------------------------------------------------------------- |
| **API Gateway Core** | **Go (Golang)**                   | Ultra-low latency proxying, goroutine concurrency, streaming support |
| **REST / Admin API** | **Node.js + Fastify**             | Fast developer experience, JSON-native, plugin ecosystem             |
| **Auth Service**     | **Node.js + Fastify + JWT**       | Stateless auth, JWKS support, SSO-ready                              |
| **Policy Engine**    | **OPA (Open Policy Agent)**       | Declarative Rego policies, auditable, language-agnostic              |
| **DLP Engine**       | **Python + Presidio (Microsoft)** | Named-entity recognition, regex, custom detectors                    |
| **Background Jobs**  | **BullMQ (Redis-backed)**         | Reliable queues for async cost aggregation, alerts                   |
| **Message Bus**      | **Apache Kafka**                  | High-throughput prompt log streaming, audit trail durability         |
| **Primary DB**       | **PostgreSQL (v16+)**             | Relational cost/budget/user data, strong ACID guarantees             |
| **Cache**            | **Redis (v7+)**                   | Virtual key lookup, rate-limit counters, session state               |
| **Time-Series DB**   | **ClickHouse**                    | Ultra-fast token/cost analytics at scale (billions of rows)          |
| **Vector Store**     | **pgvector**                      | Semantic prompt deduplication, similarity search for V4              |
| **Object Storage**   | **S3 / MinIO**                    | Raw prompt log archival, model response storage                      |
| **Search**           | **OpenSearch**                    | Full-text prompt search, DLP audit search                            |

### Frontend

| Layer          | Technology                     | Rationale                                |
| -------------- | ------------------------------ | ---------------------------------------- |
| **Framework**  | **Next.js 14 (App Router)**    | SSR + RSC, great DX, Vercel-deployable   |
| **UI Library** | **shadcn/ui + Radix UI**       | Accessible, headless, fully customizable |
| **Styling**    | **Tailwind CSS v4**            | Utility-first, consistent design tokens  |
| **Charts**     | **Recharts + Observable Plot** | Cost dashboards, token burn charts       |
| **State**      | **Zustand + TanStack Query**   | Server state sync + client state         |
| **Tables**     | **TanStack Table**             | Virtualized prompt log tables            |
| **Auth UI**    | **NextAuth.js v5**             | SSO, OAuth, SAML support                 |

### Infrastructure

| Layer             | Technology                               |
| ----------------- | ---------------------------------------- |
| **Containers**    | Docker + Kubernetes (Helm charts)        |
| **Service Mesh**  | Istio or Linkerd (mTLS between services) |
| **Ingress**       | NGINX / Traefik                          |
| **CI/CD**         | GitHub Actions + ArgoCD                  |
| **Observability** | OpenTelemetry → Grafana + Tempo + Loki   |
| **Secrets**       | HashiCorp Vault / AWS Secrets Manager    |
| **IaC**           | Terraform + Terragrunt                   |

---

## Architecture

### High-Level System Architecture

```
                        ┌─────────────────────────────────────────────────┐
                        │                   CLIENTS                       │
                        │  Apps │ Agents │ Developers │ CI/CD Pipelines   │
                        └──────────────────┬──────────────────────────────┘
                                           │ HTTPS (OpenAI-compatible API)
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          AI GATEWAY (Go)                                     │
│                                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Virtual Key │  │ Rate Limiter │  │ DLP Enforcer │  │ Policy Engine    │ │
│  │ Resolver    │  │ (Redis)      │  │ (Presidio)   │  │ (OPA)            │ │
│  └─────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘ │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │              REQUEST PIPELINE (per-request middleware)              │    │
│  │  Authenticate → Resolve Key → DLP Scan → Policy Check →            │    │
│  │  Budget Check → Smart Route → Proxy → Log → Cost Aggregate         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
  │   OpenAI     │    │  Anthropic   │    │ Azure/Gemini │
  │   Provider   │    │   Provider   │    │  /Bedrock    │
  └──────────────┘    └──────────────┘    └──────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │ Responses (streaming SSE)
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        DATA PLANE (Async)                                    │
│                                                                              │
│   Kafka Topic: prompt-logs ──► ClickHouse (analytics)                       │
│   Kafka Topic: cost-events ──► PostgreSQL (budgets/chargebacks)             │
│   Kafka Topic: dlp-alerts  ──► OpenSearch (audit search)                   │
│   Kafka Topic: agent-events──► PostgreSQL (agent registry)                 │
└──────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     CONTROL PLANE (Admin API - Node.js)                      │
│                                                                              │
│  /api/v1/keys        /api/v1/budgets      /api/v1/policies                  │
│  /api/v1/users       /api/v1/teams        /api/v1/agents                    │
│  /api/v1/analytics   /api/v1/chargebacks  /api/v1/forecasts                 │
└──────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        DASHBOARD (Next.js)                                   │
│                                                                              │
│  Cost Dashboard │ Prompt Logs │ Budget Manager │ Policy Editor │ AI Inventory│
└──────────────────────────────────────────────────────────────────────────────┘
```

### Request Flow (Per-Request Pipeline)

```
Client Request
      │
      ▼
[1] TLS Termination + NGINX Ingress
      │
      ▼
[2] Gateway: Extract Virtual Key from Authorization header
      │
      ▼
[3] Redis: Resolve Virtual Key → {provider, model, team, user, limits}
      │
      ├─── Key not found / revoked → 401 Unauthorized
      │
      ▼
[4] Rate Limiter: Check token-per-minute and request-per-minute limits (Redis)
      │
      ├─── Limit exceeded → 429 Too Many Requests
      │
      ▼
[5] DLP Engine: Scan prompt for PII, secrets, sensitive patterns
      │
      ├─── DLP violation + policy=BLOCK → 400 + DLP Alert to Kafka
      ├─── DLP violation + policy=REDACT → continue with redacted prompt
      │
      ▼
[6] OPA Policy Engine: Evaluate governance policies
      │   (allowed models, time-of-day, geo restrictions, content filters)
      ├─── Policy DENY → 403 Forbidden
      │
      ▼
[7] Budget Service: Check remaining budget for team/user/project
      │
      ├─── Budget exhausted (hard limit) → 402 Payment Required
      ├─── Budget at soft limit → continue + alert
      │
      ▼
[8] Smart Router: Select optimal provider/model
      │   (latency-based, cost-based, fallback chains, A/B splits)
      │
      ▼
[9] Provider Proxy: Forward request with real API key (from Vault)
      │   (streaming SSE passthrough / buffered)
      │
      ▼
[10] Response Interceptor: Extract token usage from response
      │
      ▼
[11] Async: Emit to Kafka
      │   → prompt-logs topic (full request/response)
      │   → cost-events topic (tokens, model, cost, team, timestamp)
      │
      ▼
[12] Return response to client
```

---

## System Workflow

### Virtual Key Lifecycle

```
Admin creates Virtual Key
         │
         ├─ Assign to: User / Team / Project / Agent
         ├─ Set: allowed models, rate limits, budget ceiling, DLP policy
         ├─ Optionally restrict: IPs, time window, environment
         │
         ▼
Key stored in PostgreSQL (metadata) + Redis (hot lookup cache)
         │
         ▼
Developer uses Virtual Key in Authorization: Bearer vk-xxxx
         │
         ▼
Gateway resolves → routes → tracks → enforces → logs
         │
         ▼
Admin can: rotate, revoke, audit, clone keys from dashboard
```

### Budget Enforcement Workflow

```
Budget created (monthly/weekly/daily, hard/soft threshold)
         │
         ▼
Each cost-event hits BullMQ worker → UPDATE budget.used += cost
         │
         ▼
Threshold checks:
  used >= soft_limit (e.g. 80%) → Slack/Email alert
  used >= hard_limit (100%)     → Gateway returns 402 on next request
         │
         ▼
Finance dashboard shows: Allocated vs Used vs Forecasted (V4)
```

### DLP Workflow

```
Incoming prompt text
         │
         ▼
Presidio Analyzer: detect entities
  [PERSON], [EMAIL], [PHONE], [CREDIT_CARD], [API_KEY], [SSN], custom regexes
         │
         ├─ No entities → pass through
         │
         ├─ Entities found → lookup DLP Policy for this Virtual Key:
         │    BLOCK  → reject request, log DLP alert
         │    REDACT → replace entities with [REDACTED], continue
         │    ALERT  → pass through, log alert (audit only)
         │    ALLOW  → pass through silently
         │
         ▼
DLP alert emitted to Kafka → OpenSearch → searchable audit log
```

### Chargeback Workflow

```
ClickHouse: cost_events table
         │
         ▼
Scheduled job (nightly/monthly):
  SELECT team_id, project_id, model, SUM(cost_usd)
  FROM cost_events
  WHERE ts BETWEEN billing_period_start AND billing_period_end
  GROUP BY team_id, project_id, model
         │
         ▼
Chargeback report generated → PostgreSQL chargeback_reports table
         │
         ▼
Exportable as: CSV, PDF, API (for Workday, SAP, internal ITSM)
Dashboard: Finance team views per-team, per-project cost allocation
```

---

## Roadmap

### V1 — Foundation

**Goal: Replace direct API key usage with a governed, observable gateway.**

**Timeline: 8–10 weeks**

```
Week 1-2: Gateway core (Go) + Virtual Key CRUD
Week 3-4: Provider integrations (OpenAI, Anthropic, Azure OpenAI)
Week 5-6: Prompt logging pipeline (Kafka → ClickHouse)
Week 7-8: Cost tracking + basic dashboard
Week 9-10: User management + auth (SSO-ready)
```

**Deliverables:**

| Feature             | Description                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| **Gateway**         | Go reverse proxy, OpenAI-compatible endpoint, streaming SSE support     |
| **Virtual Keys**    | Create/revoke/rotate keys; bind to users; Redis hot-cache               |
| **Providers**       | OpenAI, Anthropic, Azure OpenAI, Gemini (extensible provider interface) |
| **Prompt Logs**     | Full request/response capture → Kafka → ClickHouse + S3 archival        |
| **Cost Tracking**   | Per-request token cost calculation, per-user/day/model roll-up          |
| **User Management** | RBAC: Admin / Developer / Viewer; SSO via OAuth2/SAML                   |

**Success Metrics:**

- < 15ms p99 gateway overhead on non-streaming requests
- 100% of AI requests flowing through gateway
- Cost dashboard showing daily spend per user/model

---

### V2 — Governance

**Goal: Give finance and security teams the controls they need.**

**Timeline: 8–10 weeks after V1**

```
Week 1-2: Budget engine + enforcement
Week 3-4: Teams + project hierarchy
Week 5-6: Chargeback reporting engine
Week 7-8: DLP integration (Presidio)
Week 9-10: Governance policy editor (OPA)
```

**Deliverables:**

| Feature                 | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| **Budgets**             | Monthly/weekly/daily budgets; hard/soft limits; auto-alerts   |
| **Teams**               | Hierarchical org structure: Org → Department → Team → Project |
| **Chargebacks**         | Automated cost allocation reports; CSV/API export             |
| **DLP**                 | PII/secret detection in prompts; BLOCK/REDACT/ALERT policies  |
| **Governance Policies** | OPA-based rules: allowed models, time windows, geo, content   |

**Success Metrics:**

- Zero budget overruns with hard limits enabled
- DLP scanning adds < 5ms latency
- Finance team can self-serve chargeback reports

---

### V3 — Agent & Tool Control

**Goal: Govern agentic AI workflows — the next frontier of AI risk.**

**Timeline: 10–12 weeks after V2**

```
Week 1-3: Agent Registry + identity model
Week 4-6: Tool Registry + approval workflows
Week 7-9: AI Inventory (auto-discovery)
Week 10-12: Smart Routing engine
```

**Deliverables:**

| Feature             | Description                                                     |
| ------------------- | --------------------------------------------------------------- |
| **Agent Registry**  | Register AI agents: identity, owner, allowed tools, cost limits |
| **Tool Governance** | Approve/deny tool access per agent; audit tool invocations      |
| **AI Inventory**    | Auto-discover all AI usage across the org (shadow AI detection) |
| **Smart Routing**   | Route to cheapest/fastest model per SLA; fallback chains; A/B   |

**Success Metrics:**

- All agent identities traceable to a human owner
- Shadow AI usage reduced by 90%
- Smart routing reduces cost by 15-30% via model substitution

---

### V4 — Intelligence & Optimization

**Goal: Use AI to optimize AI spend and quality.**

**Timeline: 12 weeks after V3**

```
Week 1-3: Forecasting models (Prophet/ARIMA on ClickHouse data)
Week 4-6: Cost optimization engine (semantic caching, model selection)
Week 7-9: Prompt versioning + A/B testing
Week 10-12: AI Scorecards (quality, cost, latency per team)
```

**Deliverables:**

| Feature               | Description                                                      |
| --------------------- | ---------------------------------------------------------------- |
| **Forecasting**       | 30/60/90-day spend forecasts; anomaly detection; alerts          |
| **Cost Optimization** | Semantic prompt caching (pgvector); model downgrade suggestions  |
| **Prompt Versioning** | Version-controlled prompts; diff viewer; A/B test framework      |
| **AI Scorecards**     | Per-team quality + cost + latency health scores; exec dashboards |

**Success Metrics:**

- Forecast accuracy within 10% of actual spend
- Semantic cache hit rate > 20% (significant cost reduction)
- Each team has a monthly AI Scorecard for review

---

## Data Models

### Core Entities (PostgreSQL)

```sql
-- Virtual Keys
CREATE TABLE virtual_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  key_hash    TEXT UNIQUE NOT NULL,  -- SHA-256 of vk-xxxx
  team_id     UUID REFERENCES teams(id),
  user_id     UUID REFERENCES users(id),
  project_id  UUID REFERENCES projects(id),
  config      JSONB,  -- allowed_models, rate_limits, dlp_policy_id
  status      TEXT DEFAULT 'active',  -- active | revoked | expired
  created_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ
);

-- Budgets
CREATE TABLE budgets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT,
  scope_type      TEXT,  -- team | project | user | global
  scope_id        UUID,
  period          TEXT,  -- monthly | weekly | daily | custom
  period_start    DATE,
  amount_usd      NUMERIC(12,4),
  soft_threshold  NUMERIC(5,2) DEFAULT 0.80,  -- 80%
  hard_limit      BOOLEAN DEFAULT false,
  used_usd        NUMERIC(12,4) DEFAULT 0,
  status          TEXT DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Agent Registry
CREATE TABLE agents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  owner_id        UUID REFERENCES users(id),
  team_id         UUID REFERENCES teams(id),
  virtual_key_id  UUID REFERENCES virtual_keys(id),
  allowed_tools   TEXT[],
  max_cost_usd    NUMERIC(10,4),
  status          TEXT DEFAULT 'active',
  metadata        JSONB,
  registered_at   TIMESTAMPTZ DEFAULT now()
);

-- DLP Policies
CREATE TABLE dlp_policies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT,
  entities    TEXT[],  -- PERSON, EMAIL, PHONE, CREDIT_CARD, API_KEY, ...
  action      TEXT,    -- BLOCK | REDACT | ALERT | ALLOW
  scope       JSONB,   -- applies to: team, key, project
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### Analytics (ClickHouse)

```sql
CREATE TABLE cost_events (
  ts              DateTime64(3),
  request_id      UUID,
  virtual_key_id  UUID,
  user_id         UUID,
  team_id         UUID,
  project_id      UUID,
  agent_id        UUID,
  provider        LowCardinality(String),
  model           LowCardinality(String),
  prompt_tokens   UInt32,
  completion_tokens UInt32,
  total_tokens    UInt32,
  cost_usd        Decimal(12, 6),
  latency_ms      UInt32,
  status_code     UInt16,
  environment     LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (team_id, ts);
```

---

## API Design

### Gateway Endpoint (OpenAI-compatible)

```
POST /v1/chat/completions        → proxied to provider
POST /v1/completions             → proxied to provider
POST /v1/embeddings              → proxied to provider
GET  /v1/models                  → list available models
Authorization: Bearer vk-xxxxxxxxxxxxxxxx
```

### Admin API

```
# Virtual Keys
GET    /api/v1/keys
POST   /api/v1/keys
GET    /api/v1/keys/:id
PATCH  /api/v1/keys/:id
DELETE /api/v1/keys/:id
POST   /api/v1/keys/:id/rotate

# Budgets
GET    /api/v1/budgets
POST   /api/v1/budgets
GET    /api/v1/budgets/:id/usage
GET    /api/v1/budgets/:id/forecast    (V4)

# Agents
GET    /api/v1/agents
POST   /api/v1/agents
GET    /api/v1/agents/:id/events
PATCH  /api/v1/agents/:id/status

# DLP
GET    /api/v1/dlp/policies
POST   /api/v1/dlp/policies
GET    /api/v1/dlp/alerts?from=&to=

# Chargebacks
GET    /api/v1/chargebacks?period=2025-01
POST   /api/v1/chargebacks/export      → returns CSV/PDF

# Analytics
GET    /api/v1/analytics/cost?group_by=team&period=7d
GET    /api/v1/analytics/tokens?model=gpt-4o&period=30d
GET    /api/v1/analytics/latency?provider=openai
```

---

## Infrastructure & Deployment

### Kubernetes Architecture

```
Namespace: ai-gateway
  ├── Deployment: gateway          (Go, 3 replicas, HPA)
  ├── Deployment: admin-api        (Node.js, 2 replicas)
  ├── Deployment: dlp-service      (Python, 2 replicas)
  ├── Deployment: policy-engine    (OPA, 2 replicas)
  ├── Deployment: dashboard        (Next.js, 2 replicas)
  ├── StatefulSet: kafka           (3 brokers)
  ├── StatefulSet: clickhouse      (3 nodes)
  ├── StatefulSet: postgres        (primary + replica)
  ├── StatefulSet: redis           (sentinel mode)
  └── CronJob: chargeback-gen      (monthly)

Namespace: monitoring
  ├── Deployment: grafana
  ├── Deployment: prometheus
  ├── Deployment: tempo
  └── Deployment: loki
```

### Environment Strategy

| Environment    | Purpose                                             |
| -------------- | --------------------------------------------------- |
| **dev**        | Local Docker Compose; mocked LLM responses          |
| **staging**    | Kubernetes; real LLM providers; synthetic traffic   |
| **production** | Multi-region Kubernetes; HA Postgres; Kafka cluster |

---

## Security Model

| Control            | Implementation                                                    |
| ------------------ | ----------------------------------------------------------------- |
| **Real API Keys**  | Stored in HashiCorp Vault; never in DB or env vars                |
| **Virtual Keys**   | Only SHA-256 hash stored in DB; key shown once at creation        |
| **mTLS**           | All service-to-service communication via Istio                    |
| **RBAC**           | Admin / Developer / Analyst / Finance / Viewer roles              |
| **Audit Log**      | Immutable append-only log in ClickHouse; 90-day default retention |
| **Data Residency** | Prompt logs tagged by region; configurable per-team               |
| **SSO**            | SAML 2.0 / OIDC; supports Okta, Azure AD, Google Workspace        |
| **SOC2 Ready**     | Audit log, access controls, encryption at rest & in transit       |

---

## Contributing

```bash
# Clone & setup
git clone https://github.com/your-org/ai-gateway
cd ai-gateway

# Start local stack
docker compose up -d

# Run gateway (Go)
cd services/gateway && go run ./cmd/gateway

# Run admin API (Node.js)
cd services/admin-api && npm install && npm run dev

# Run dashboard (Next.js)
cd apps/dashboard && npm install && npm run dev
```

### Monorepo Structure

```
ai-gateway/
├── services/
│   ├── gateway/          # Go — core proxy
│   ├── admin-api/        # Node.js — control plane
│   ├── dlp-service/      # Python — PII detection
│   └── policy-engine/    # OPA — governance rules
├── apps/
│   └── dashboard/        # Next.js — UI
├── infra/
│   ├── terraform/        # IaC
│   ├── helm/             # Kubernetes charts
│   └── docker-compose.yml
├── libs/
│   ├── provider-sdk/     # Shared provider adapters
│   └── cost-calculator/  # Token pricing library
└── docs/
    └── architecture.html # Visual architecture doc
```

---

_Built for enterprise AI governance. Every token tracked. Every policy enforced. Every cost attributed._
