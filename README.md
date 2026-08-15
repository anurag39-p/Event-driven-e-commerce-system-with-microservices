# Event-Driven E-Commerce System

Phase 1: Infrastructure Skeleton — every container running and talking to each other.

## What's in this phase

- 5 Express microservices (user, product, order, payment, notification), each just a `/health` stub for now
- An API Gateway that proxies `/api/*` routes to the right service
- PostgreSQL + RabbitMQ running via Docker Compose
- MongoDB is assumed to be running **locally on your machine** (since you already have it installed) — containers reach it via `host.docker.internal`

## Prerequisites

- Docker Desktop installed and running
- Your local MongoDB running (default port 27017)

## Setup

```bash
# 1. Copy the environment file (already done for you, but if starting fresh):
cp .env.example .env

# 2. Build and start everything
docker-compose up --build
```

First build will take a minute or two (pulling base images, installing npm deps in each container).

## Verify it's working

Once containers are up, check each service's health endpoint:

```bash
curl http://localhost:4000/health   # API Gateway
curl http://localhost:4001/health   # User Service (direct)
curl http://localhost:4002/health   # Product Service (direct)
curl http://localhost:4003/health   # Order Service (direct)
curl http://localhost:4004/health   # Payment Service (direct)
curl http://localhost:4005/health   # Notification Service (direct)
```

Each should return something like:
```json
{ "service": "order-service", "status": "ok", "timestamp": "2026-07-05T..." }
```

Also check that routing through the Gateway works — this proves the proxy layer is wired correctly:

```bash
curl http://localhost:4000/api/orders/health
```

(Note: since each service's `/health` route sits at its root, and the Gateway strips `/api/orders`, hitting `/api/orders/health` should route to order-service's `/health`.)

## Check the infra

- **RabbitMQ Management UI**: http://localhost:15672 (login: `guest` / `guest`) — should show an empty but running broker
- **PostgreSQL**: connect on `localhost:5432` with user `admin` / password `admin123` / db `ecommerce` (via pgAdmin, DBeaver, or `psql`)

## Project structure

```
ecommerce/
├── docker-compose.yml
├── .env.example
├── api-gateway/
│   ├── Dockerfile
│   ├── package.json
│   └── src/index.js
├── services/
│   ├── user-service/
│   ├── product-service/
│   ├── order-service/
│   ├── payment-service/
│   └── notification-service/
│       (each: Dockerfile, package.json, src/index.js)
└── frontend/          (React app — added in Phase 8)
```

## Phase 1 checkpoint (don't move on until this passes)

- [ ] `docker-compose up` boots all 7 containers (postgres, rabbitmq, 5 services) with no crash loops
- [ ] All 5 services respond on their direct health endpoints
- [ ] API Gateway successfully proxies at least one request through to a service
- [ ] RabbitMQ management UI loads in the browser
- [ ] You can connect to PostgreSQL with a client of your choice

## Troubleshooting

- **Port already in use**: something else on your machine is using 4000-4005, 5432, 5672, or 15672. Stop it or change the port mapping in `docker-compose.yml`.
- **`host.docker.internal` not resolving (Linux)**: this hostname works out of the box on Docker Desktop (Mac/Windows). On native Linux Docker, add this under each service that needs Mongo:
  ```yaml
  extra_hosts:
    - "host.docker.internal:host-gateway"
  ```
- **Service crash-looping**: run `docker-compose logs <service-name>` to see the error.
