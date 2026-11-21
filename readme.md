# Yatra AI ✈️🚆🏨

**Yatra AI** is an intelligent, real-world travel planning and execution platform. Unlike generic chatbots that hallucinate flight numbers and fabricate hotel rates, Yatra AI connects directly to live travel APIs, computes real road driving routes, links destinations into a graph database (Neo4j), processes real payments via Razorpay, and generates zero-backtracking, day-by-day itineraries.

---

## Architecture & Workflow Overview

```
User Input (Origin, Destination, Dates, Passengers, Budget Tier)
  │
  ├── [Phase 1] Concurrent Fan-Out Search (Promise.allSettled)
  │     ├── Flight Search (Amadeus API + Offline IATA Resolver)
  │     └── Train Search (IRCTC via RapidAPI + Station Resolver)
  │
  ├── [Phase 2] Transport Selection Gate (HITL)
  │     └── Live IRCTC Fare Verification for Selected Train Class
  │
  ├── [Phase 3A] Hotel Discovery
  │     └── Amadeus Hotel Offers (or OpenStreetMap Nominatim Fallback)
  │
  ├── [Phase 3B] Background Knowledge Graph (Non-blocking Async)
  │     └── Cache check: MongoDB CityGraph
  │           └── On Miss: OSM Attractions ➔ OSRM Pairwise Road Routes ➔ Neo4j
  │
  ├── [Phase 4] Hotel Selection Gate (HITL)
  │     └── Captures Hotel Geo-Coordinates
  │
  ├── [Phase 5] Checkout & Payment
  │     ├── Itemized Invoice (Transport + Hotel)
  │     ├── Razorpay Order Creation (`razorpay.orders.create`)
  │     └── Cryptographic HMAC-SHA256 Signature Verification
  │
  ├── [Phase 6] Hotel-to-Graph Linking
  │     └── Links Confirmed Hotel to City Attractions in Neo4j via OSRM Routes
  │
  └── [Phase 7] Itinerary Optimization (Zero-Backtracking)
        ├── Parameterized Graph Queries (nearest / within km / all)
        ├── OSRM Trip API (TSP Solver for zero-zigzag routing)
        └── Day Partitioning (≤ 8 hours sightseeing/day + timeline generation)
```

---

## Tech Stack

| Layer | Technologies & Libraries |
|---|---|
| **Runtime & Backend** | Node.js (ES Modules), Express 4.21, Mongoose 8.9 |
| **Databases** | MongoDB Atlas (Trips, Sessions, Caching), Neo4j 5+ (Attraction & Road Network Graph) |
| **Authentication** | JWT stored in `httpOnly`, `sameSite: strict` cookie (anti-XSS, anti-CSRF) + bcryptjs |
| **Flights** | Amadeus Self-Service API (`/v2/shopping/flight-offers`) + OAuth token caching |
| **Trains** | IRCTC via RapidAPI (`trainBetweenStations` + live class fare verification) |
| **Hotels** | Amadeus Hotel API with OpenStreetMap Nominatim fallback |
| **Payments** | Razorpay SDK (Order generation + HMAC-SHA256 verification + dev mock fallback) |
| **Routing & Geocoding** | OSRM (`router.project-osrm.org`), OSM Nominatim (100% free, no API key required) |
| **Airport Resolver** | Offline-first 7,000+ airport database (`airport-data` via `createRequire`) |
| **Model Context Protocol (MCP)** | Official `@modelcontextprotocol/sdk` connecting live Weather & Places photography tools |
| **AI Agent Framework** | LangGraph.js + Groq (`llama-3.3-70b-versatile`) with dynamic tool execution |
| **Frontend** | React 19, Vite 8, Tailwind CSS v4, DaisyUI 5, Framer Motion 14 |

---

## Trip State Machine

Every trip is tracked by a single MongoDB `tripId`. If the user leaves or refreshes the page, the session resumes at its exact locked phase:

```
INPUT_VALIDATED
      ↓
TRANSPORT_SEARCHED
      ↓
TRANSPORT_SELECTED   (HITL Gate 1)
      ↓
HOTELS_SEARCHED      (Triggers Background Neo4j Graph Build)
      ↓
HOTEL_SELECTED       (HITL Gate 2)
      ↓
PAYMENT_PENDING
      ↓
BOOKING_CONFIRMED    (Razorpay HMAC Verified)
      ↓
HOTEL_GRAPH_LINKED
      ↓
ITINERARY_FINALIZED
```

---

## Implemented API Endpoints

### Authentication (`/api/auth`)
* `POST /api/auth/register` — Creates user, hashes password, sets `jwt` httpOnly cookie.
* `POST /api/auth/login` — Verifies password, sets `jwt` httpOnly cookie.
* `POST /api/auth/logout` — Clears `jwt` cookie.
* `GET /api/auth/me` — Returns current logged-in user and saved travel preferences.

### Trip Lifecycle (`/api/trips`)
* `POST /api/trips` — Initializes and validates a trip spec (`INPUT_VALIDATED`).
* `GET /api/trips/:tripId` — Fetches current trip state and saved results.
* `POST /api/trips/:tripId/transport/search` — Runs parallel flight and train search (`TRANSPORT_SEARCHED`).
* `POST /api/trips/:tripId/transport/select` — Locks user's transport choice & verifies live IRCTC train fares (`TRANSPORT_SELECTED`).
* `POST /api/trips/:tripId/hotels/search` — Searches city-wide or within a radius of a landmark (`HOTELS_SEARCHED`), triggering background Neo4j graph generation.
* `POST /api/trips/:tripId/hotels/select` — Locks hotel selection with coordinates (`HOTEL_SELECTED`).
* `GET /api/trips/:tripId/review` — Generates itemized checkout invoice.
* `POST /api/trips/:tripId/payment/order` — Creates a Razorpay order (`PAYMENT_PENDING`).
* `POST /api/trips/:tripId/payment/verify` — Validates HMAC-SHA256 signature and confirms booking (`BOOKING_CONFIRMED`).
* `POST /api/trips/:tripId/hotel-graph/link` — Connects confirmed hotel to destination attractions in Neo4j (`HOTEL_GRAPH_LINKED`).
* `POST /api/trips/:tripId/itinerary/optimize` — Generates zero-backtracking daily itinerary using Neo4j and OSRM TSP solver (`ITINERARY_FINALIZED`).
* `GET /api/trips/:tripId/itinerary` — Retrieves saved, finalized itinerary.

### AI Agent Endpoints (`/api/agent`)
* `GET /api/agent/status` — Checks LLM model status and Groq configuration.
* `POST /api/agent/chat` — Conversational AI planning endpoint powered by LangGraph.js and Groq (Llama 3.3 70B) with automated tool calling.

---

## Environment Configuration

Create a `.env` file inside the `backend/` directory:

```env
# Server
PORT=5000
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:5173

# Authentication
JWT_SECRET=your_super_secret_jwt_key_here

# MongoDB (Required)
MONGODB_URI=mongodb://127.0.0.1:27017/yatra_ai

# Neo4j Graph Database (Optional - graph bypassed gracefully if omitted)
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_neo4j_password

# Amadeus Self-Service API (Optional - uses OSM fallback for hotels if omitted)
AMADEUS_CLIENT_ID=your_amadeus_client_id
AMADEUS_CLIENT_SECRET=your_amadeus_client_secret

# RapidAPI / IRCTC (Optional - empty results if omitted)
RAPID_API_KEY=your_rapidapi_key

# Razorpay (Optional - automatically runs dev mock orders if omitted)
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

# LLM / Groq (For Agentic Layer)
GROQ_API_KEY=your_groq_api_key
```

---

## Current Status & Next Steps

### What is Completed (Backend ~85%)
- [x] Full JWT cookie authentication and travel preferences.
- [x] Complete 8-phase deterministic trip state machine.
- [x] Offline IATA resolver and railway station code normalization.
- [x] Parallel flight and train search with live fare verification.
- [x] Hotel discovery by city or landmark radius.
- [x] Non-blocking background Neo4j attraction graph with MongoDB caching.
- [x] Itemized checkout invoice and Razorpay HMAC-SHA256 signature verification.
- [x] Hotel-to-attraction graph linkage with live OSRM road routes.
- [x] Zero-backtracking itinerary generator using OSRM Travelling Salesperson (TSP) algorithm.
- [x] LangGraph AI Agent Orchestrator with Groq Llama 3.3 70B and dynamic tool calling (`/api/agent/chat`).
- [x] Model Context Protocol (MCP) Integration: Live Weather (Open-Meteo) & Places Photography tools dynamically bound to the Agent.

### What is Remaining to Build
- [ ] **Frontend Application**: Build the interactive Trip Wizard (transport cards, hotel picker, Razorpay checkout modal, and day-by-day itinerary view).

---

## Local Development

```bash
# 1. Start Backend
cd backend
npm install
npm run dev

# 2. Start Frontend
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.
