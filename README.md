# 🧠 AI FinOps & Governance Gateway

> Enterprise-grade AI cost governance, observability, and policy enforcement — from a unified gateway.

## Architecture

```
AI-Gov/
├── services/
│   ├── gateway/          # Go — core reverse proxy
│   └── admin-api/        # Node.js + Fastify — control plane API
├── apps/
│   └── dashboard/        # Next.js 15 — premium admin UI
├── libs/
│   └── cost-calculator/  # Shared token pricing library
├── infra/
│   ├── docker-compose.yml
│   └── k8s/              # Kubernetes manifests + Helm
└── docs/
    ├── architecture.html
    └── project-plan.md
```

## Quick Start

```bash
# Start infrastructure (PostgreSQL + Redis)
cd infra && docker compose up -d

# Start Admin API
cd services/admin-api && npm install && npm run dev

# Start Gateway
cd services/gateway && go run ./cmd/gateway

# Start Dashboard
cd apps/dashboard && npm install && npm run dev
```

## V1 Features
- **Gateway** — Go reverse proxy, OpenAI-compatible, SSE streaming
- **Virtual Keys** — Create/revoke/rotate, Redis hot-cache
- **Providers** — Gemini (primary), OpenAI, Anthropic, Azure (mock)
- **Prompt Logs** — Full request/response capture
- **Cost Tracking** — Per-request token cost, daily rollups
- **User Management** — RBAC with NextAuth.js SSO
- **Dashboard** — Premium dark UI with cost analytics

---

_Built for enterprise AI governance. Every token tracked. Every policy enforced. Every cost attributed._
