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







# Event-Driven E-Commerce Platform

A microservices-based e-commerce platform built around asynchronous, event-driven communication using RabbitMQ. The system demonstrates distributed order processing, Saga orchestration, fault handling, idempotency, JWT-based authorization, and containerized service deployment.

## Architecture

The application is divided into independent services responsible for different business capabilities.

```text
                         ┌─────────────────┐
                         │   React Client  │
                         └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │   API Gateway   │
                         └────────┬────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
       ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
       │    User     │     │   Product   │     │    Order    │
       │   Service   │     │   Service   │     │   Service   │
       └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
              │                   │                   │
              ▼                   ▼                   │
        PostgreSQL             MongoDB                │
                                                      │
                                                      ▼
                                             ┌────────────────┐
                                             │    RabbitMQ    │
                                             │ Event Exchange │
                                             └───────┬────────┘
                                                     │
                                                     ▼
                                             ┌────────────────┐
                                             │ Payment Service │
                                             └───────┬────────┘
                                                     │
                                                     │ Payment Result
                                                     ▼
                                             ┌────────────────┐
                                             │    RabbitMQ    │
                                             └───────┬────────┘
                                                     │
                                                     ▼
                                             ┌────────────────┐
                                             │ Order Service  │
                                             └────────────────┘
Key Features
Microservices-based architecture
Event-driven communication using RabbitMQ
Saga-based order/payment orchestration
Asynchronous payment processing
Payment success and compensating failure workflows
Retry handling and Dead Letter Queues (DLQ)
Idempotent event processing
JWT-based authentication and authorization
User-scoped carts and orders
Product search and category filtering
Asynchronous checkout with order-status polling
Order history
Persisted order lifecycle events
Order timeline with backend-generated timestamps
Docker and Docker Compose based deployment
PostgreSQL and MongoDB for service-specific persistence
Jest-based backend testing
Services
1. User Service

Responsible for:

User registration
User authentication
Password validation
JWT generation
User identity used for authorization

Database:

PostgreSQL

2. Product Service

Responsible for:

Product catalog
Product information
Product search
Category-based filtering
Product availability

Database:

MongoDB

3. Order Service

Responsible for:

Creating orders
Maintaining order state
Publishing order events
Consuming payment results
Maintaining order history
Persisting order lifecycle events
Authorization for user orders

Order states:

PENDING
   │
   ├──────────────► CONFIRMED
   │
   └──────────────► CANCELLED

The Order Service acts as the primary coordinator for the order/payment workflow.

Database:

PostgreSQL

4. Payment Service

Responsible for:

Consuming payment requests
Simulating payment processing
Publishing payment success/failure events
Returning failure reasons

Example payment outcomes:

OrderCreated
     │
     ▼
PaymentInitiated
     │
     ├──────────────► PaymentSucceeded
     │                       │
     │                       ▼
     │                OrderConfirmed
     │
     └──────────────► PaymentFailed
                             │
                             ▼
                       OrderCancelled
5. Notification Service

Responsible for consuming relevant system events and providing the foundation for event-driven notifications.

Event-Driven Order Processing

RabbitMQ is used to decouple services and allow asynchronous communication.

The main order flow is:

React
  │
  ▼
API Gateway
  │
  ▼
Order Service
  │
  ├── Create PENDING order
  │
  ├── Record OrderCreated
  │
  └── Publish OrderCreated
              │
              ▼
          RabbitMQ
              │
              ▼
      Payment Service
              │
       Process payment
              │
       ┌──────┴──────┐
       │             │
       ▼             ▼
 PaymentSucceeded  PaymentFailed
       │             │
       ▼             ▼
    RabbitMQ      RabbitMQ
       │             │
       ▼             ▼
 Order Service    Order Service
       │             │
       ▼             ▼
   CONFIRMED      CANCELLED

This avoids making the Order Service synchronously depend on the Payment Service.

Saga Workflow

The order/payment workflow follows a Saga-style approach.

Successful workflow
OrderCreated
     ↓
PaymentInitiated
     ↓
PaymentSuccessful
     ↓
OrderConfirmed
Failure / compensation workflow
OrderCreated
     ↓
PaymentInitiated
     ↓
PaymentFailed
     ↓
OrderCancelled

When payment fails, the order is transitioned to CANCELLED and the failure reason is persisted.

Example:

Cancellation reason:
Simulated card decline
Order Timeline

The system persists important order lifecycle events instead of keeping the timeline only in the frontend.

Example:

Order Created
23:37:36.855

Payment Initiated
23:37:36.862

Payment Failed
23:37:36.902
Simulated card decline

Order Cancelled
23:37:36.909
Simulated card decline

For a successful order:

Order Created
      ↓
Payment Initiated
      ↓
Payment Successful
      ↓
Order Confirmed

Each event contains information such as:

Event name
Responsible service
Success/failure state
Event detail/reason
Backend-generated timestamp

This provides visibility into the asynchronous workflow across service boundaries.

Reliability

The system includes several mechanisms intended to make asynchronous processing more reliable.

Idempotency

Events are processed in an idempotent manner to reduce the risk of duplicate processing when messages are redelivered.

Retry Handling

Transient processing failures can be retried rather than immediately losing the event.

Dead Letter Queue

Messages that cannot be successfully processed after retry attempts can be routed to a Dead Letter Queue for further investigation.

Persisted Events

Important order lifecycle events are persisted so that the state transition history remains available after the request itself has completed.

Authentication & Authorization

Authentication is implemented using JWT.

The general flow is:

Login
  ↓
User Service
  ↓
JWT
  ↓
React
  ↓
Authorization Header
  ↓
API Gateway / Services

Authorization is enforced using the authenticated user's identity.

Users can only access their own:

Cart
Orders
Order history

For example, a user cannot retrieve another user's order simply by changing the order ID.

Frontend

The frontend is built using React and Vite.

Main functionality includes:

Product catalog
Category filtering
Product search
Shopping cart
Per-user cart isolation
Checkout
Asynchronous order status polling
Order history
Order status display
Order lifecycle timeline
Login and registration
JWT-based authentication
Responsive UI

The checkout does not assume that payment completes synchronously.

Instead:

Create Order
     ↓
PENDING
     ↓
Poll Order Status
     ↓
CONFIRMED / CANCELLED

This reflects the asynchronous nature of the backend architecture.

Technology Stack
Frontend
React
Vite
JavaScript
React Router
Context API
TanStack Query
CSS
Backend
Node.js
Express.js
REST APIs
Messaging
RabbitMQ
AMQP
Event-driven communication
Databases
PostgreSQL
MongoDB
Authentication
JWT
Testing
Jest
Supertest
DevOps
Docker
Docker Compose
Project Structure
Event-Driven E-Commerce System/
│
├── frontend/
│
├── services/
│   ├── api-gateway/
│   ├── user-service/
│   ├── product-service/
│   ├── order-service/
│   ├── payment-service/
│   └── notification-service/
│
├── docker-compose.yml
│
└── README.md

The exact directory structure may vary as services evolve.

Running the Project
Prerequisites

Install:

Docker Desktop
Docker Compose
Git

The application services, databases, and RabbitMQ can be started through Docker Compose.

Start the system
docker-compose up --build

To run in detached mode:

docker-compose up --build -d

Check running containers:

docker-compose ps

View logs:

docker-compose logs -f

View logs for a specific service:

docker-compose logs -f order-service
Testing

Backend tests use Jest.

For the Order Service:

docker-compose run --rm order-service npm test

The tests cover critical behavior such as:

Order creation
Order authorization
Payment success
Payment failure
Cancellation handling
Order status transitions
Order timeline events

Additional test coverage can be expanded as the project evolves.

Example Order Lifecycle
Successful Payment
User places order
       ↓
Order Service creates PENDING order
       ↓
OrderCreated event
       ↓
RabbitMQ
       ↓
Payment Service
       ↓
Payment successful
       ↓
PaymentSuccessful event
       ↓
RabbitMQ
       ↓
Order Service
       ↓
Order CONFIRMED
Failed Payment
User places order
       ↓
Order Service creates PENDING order
       ↓
OrderCreated event
       ↓
RabbitMQ
       ↓
Payment Service
       ↓
Payment fails
       ↓
PaymentFailed event
       ↓
RabbitMQ
       ↓
Order Service
       ↓
Order CANCELLED
       ↓
Cancellation reason persisted
Engineering Concepts Demonstrated

This project was built to explore practical distributed-system concepts rather than only traditional CRUD operations.

Key concepts include:

Microservices
Event-driven architecture
Asynchronous messaging
Saga pattern
Eventual consistency
Idempotency
Retry mechanisms
Dead Letter Queues
Service-specific databases
JWT authentication
Authorization
Distributed workflow tracking
Containerization
Automated testing
Future Improvements

Possible future improvements include:

Increased automated test coverage
Integration and end-to-end testing
Centralized logging
Metrics and monitoring
Distributed tracing
Production deployment
CI/CD pipeline
Improved notification workflows
More sophisticated payment integration

These are intentionally kept separate from the current architecture so that additional infrastructure can be introduced when required.

Project Goals

The primary goal of this project is to demonstrate how an e-commerce workflow can be designed using distributed services and asynchronous communication.

Instead of implementing the application as a single monolithic backend, the project separates business responsibilities and uses RabbitMQ to coordinate asynchronous workflows between services.

The project focuses particularly on:

reliability, asynchronous communication, failure handling, authorization, and observability of distributed order processing.


### One change I'd make before putting this on GitHub

Your README currently says **"real-time order lifecycle timeline"** in places. Since you're using polling rather than SSE/WebSockets, I'd use **"order lifecycle timeline"** or **"live order-status tracking"** instead.

For example:

> `Order lifecycle timeline with backend-generated timestamps`

is technically precise and actually **stronger** for an engineering portfolio because it tells the reviewer that the events are persisted by the backend rather than being fake frontend status updates.

Also, once your Jest work is finished, update the Testing section with the **actual test count**, e.g. `32 tes
