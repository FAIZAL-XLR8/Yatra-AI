# Yatra AI

An agentic AI travel-planning and booking platform. It is **not** a chatbot that invents itineraries. It plans trips from real data and books them with a simulated wallet.

## Four principles

1. **Real data only.** Flights, fares, hotel rates, ratings and ticket fees come from real APIs. Only the final checkout is simulated (virtual wallet).
2. **Zero-backtracking itineraries.** A Neo4j graph stores real distances and drive times, so each day's plan is geographically sensible.
3. **Conversational booking.** "Looks good, book it" triggers a booking agent that debits the wallet, creates records and streams progress live.
4. **Hybrid memory (GraphRAG).** Pinecone holds unstructured memory (preferences). Neo4j holds structured spatial relationships.

---

## Architecture

```
User message
  -> Classifier (non_travel -> END)
  -> Planner (reads Pinecone preferences)
       -> Flight Agent    (MCP: live flights)
       -> Hotel Agent     (MCP: live hotels)
       -> Itinerary Agent (Neo4j + weather)
  -> Final Agent (streams answer + INR budget over Socket.IO)
  -> user says "book it"
  -> Booking Agent (verify balance -> escrow -> PNR/voucher -> atomic debit -> booking:success)
```

### Two-tier data rule (never break)

| Store | What goes in it |
|---|---|
| **Neo4j** | Static facts only: coordinates, distances, drive times, opening hours, official entry fees |
| **MCP server** | Live data fetched at runtime: flights, hotels, weather |
| **Never in Neo4j** | Volatile prices (flight fares, hotel rates) |

Cab fare is computed at runtime:
`cabPrice = (baseFare + distanceKm * ratePerKm) * surgeMultiplier`
(distance from Neo4j, surge from time of day and weather)

### Neo4j schema

Nodes: `Hotel`, `Attraction`, `Restaurant`
Relationships: `CAB_ROUTE` (Hotel -> Attraction), `NEARBY_DINING` (Hotel -> Restaurant), `CONNECTS_TO` (Attraction -> Attraction)

### Wallet

- `User.walletBalance` (default 50000, sandbox credit)
- `WalletTransaction` ledger: `userId, bookingId, type (CREDIT | DEBIT | ESCROW_LOCK), amount, balanceBefore, balanceAfter, razorpayPaymentId`
- Debit + ledger write happen in **one MongoDB transaction** so you never get a debit without a ledger row (or the reverse).

---

## Tech stack

| Layer | Tools |
|---|---|
| Backend | Node.js (ES Modules), Express, Socket.IO, MongoDB Atlas + Mongoose |
| Graph / Vector | Neo4j (`neo4j-driver`), Pinecone |
| AI | LangGraph JS, Groq (Llama) via `@langchain/groq`, Google GenAI embeddings, MCP server |
| External APIs | Amadeus (flights, hotels), OpenWeatherMap, OSRM or Google Distance Matrix |
| Payments | Razorpay (test mode) |
| Frontend | React (Vite), Tailwind CSS, Lucide React, jsPDF |

> Model names change often. Before using any model, check the current name in the official Groq / Google docs.

---

## Folder layout

```
yatra-ai/
  backend/
  frontend/
  README.md
  .gitignore
```

Do not reorganize without agreeing with Faizal first.

---

## Environment variables

Add each variable to `.env.example` only in the step that first needs it. Never commit `.env`.

| Variable | First needed in |
|---|---|
| `PORT`, `NODE_ENV`, `CLIENT_ORIGIN` | Phase 1 |
| `MONGODB_URI`, `JWT_SECRET` | Phase 2 |
| `GROQ_API_KEY` | Phase 4 |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Phase 5 |
| `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` | Phase 6 |
| `OPENWEATHER_API_KEY`, `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET` | Phase 7 |
| `GEMINI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX` | Phase 9 |

---

## Git workflow

- Each person works on their own branch (mine: `anmol-dev`). Never commit directly to `main`.
- Before each new step: `git pull origin main`, then merge into your branch if Faizal pushed.
- Commit after every finished step, small and focused, e.g. `feat(backend): add health check route`.
- Open a pull request to `main` after each completed phase.

---

## Step-by-step roadmap

Each step should take about 15-40 minutes and touch 1-3 files. Finish and verify one step before starting the next.

### Phase 0 - Foundation
- [ ] 0.1 Check repo state and branch (`anmol-dev`)
- [ ] 0.2 Write the `.gitignore` (node_modules, .env, build output)
- [ ] 0.3 Create `.env.example` (empty for now) and this README skeleton
- [ ] 0.4 Understand the `backend/` and `frontend/` layout

### Phase 1 - Backend skeleton
- [ ] 1.1 `npm init`, set `"type": "module"`, install Express
- [ ] 1.2 Config loader (read env vars in one place)
- [ ] 1.3 Minimal Express server listening on `PORT`
- [ ] 1.4 `GET /api/health` route
- [ ] 1.5 404 handler + central error-handling middleware
- [ ] 1.6 CORS using `CLIENT_ORIGIN`

### Phase 2 - Database and auth
- [ ] 2.1 Connect MongoDB Atlas with Mongoose
- [ ] 2.2 `User` model (name, email, passwordHash, `walletBalance` default 50000)
- [ ] 2.3 Register route (bcrypt hashing)
- [ ] 2.4 Login route (issue JWT)
- [ ] 2.5 Auth middleware (verify JWT)
- [ ] 2.6 `GET /api/auth/me` protected route
- [ ] 2.7 Test everything in Postman / Thunder Client

### Phase 3 - Frontend shell
- [ ] 3.1 Vite + React + Tailwind setup
- [ ] 3.2 React Router with basic layout
- [ ] 3.3 Register page
- [ ] 3.4 Login page
- [ ] 3.5 Auth context (store token, current user)
- [ ] 3.6 Protected route wrapper

### Phase 4 - Real-time chat (no agents yet)
- [ ] 4.1 Socket.IO server attached to Express
- [ ] 4.2 Socket auth using the JWT
- [ ] 4.3 Socket.IO client + simple chat UI that echoes messages
- [ ] 4.4 One Groq call (non-streaming) replacing the echo
- [ ] 4.5 Token-by-token streaming to the client
- [ ] 4.6 `Chat` and `Message` models, save conversations
- [ ] 4.7 Load previous chats on page open

### Phase 5 - Wallet
- [ ] 5.1 `WalletTransaction` model
- [ ] 5.2 `GET /api/wallet` (balance + history)
- [ ] 5.3 `debitWallet()` with a MongoDB transaction (learn why atomic)
- [ ] 5.4 Escrow lock / release logic
- [ ] 5.5 Razorpay test-mode order creation
- [ ] 5.6 Payment signature verification + credit wallet
- [ ] 5.7 Wallet top-up UI

### Phase 6 - Neo4j spatial graph
- [ ] 6.1 Run Neo4j locally, open the browser
- [ ] 6.2 Cypher basics: create one `Hotel` node
- [ ] 6.3 Add a few `Attraction` nodes for ONE city (real places, real coordinates)
- [ ] 6.4 Add `Restaurant` nodes
- [ ] 6.5 Add `CAB_ROUTE` relationships with real distances
- [ ] 6.6 Add `CONNECTS_TO` and `NEARBY_DINING`
- [ ] 6.7 Query: nearest attractions to a hotel
- [ ] 6.8 Query: filtered traversal (opening hours, max travel time)
- [ ] 6.9 Query: aggregation for a day-plan route
- [ ] 6.10 Wrap in a `graphService.js` using `neo4j-driver`

### Phase 7 - MCP travel server
- [ ] 7.1 Learn what MCP is (tools, server, client)
- [ ] 7.2 Minimal MCP server with ONE tool: weather
- [ ] 7.3 Connect the backend as an MCP client and call the tool
- [ ] 7.4 Add flight search tool (Amadeus)
- [ ] 7.5 Add hotel search tool (Amadeus)
- [ ] 7.6 Add dynamic cab-fare tool (distance from Neo4j + surge)
- [ ] 7.7 Handle API errors and empty results honestly (no fake data)

### Phase 8 - LangGraph orchestration
- [ ] 8.1 Learn state, nodes, edges; build a 2-node graph
- [ ] 8.2 Classifier node + conditional edge (`non_travel` -> END)
- [ ] 8.3 Planner node (extract destination, dates, budget)
- [ ] 8.4 Flight agent node (MCP)
- [ ] 8.5 Hotel agent node (MCP)
- [ ] 8.6 Itinerary agent node (Neo4j + weather)
- [ ] 8.7 Parallel fan-out and fan-in
- [ ] 8.8 Final agent: stream answer + INR budget over Socket.IO
- [ ] 8.9 Emit step-progress events for the UI

### Phase 9 - Pinecone memory
- [ ] 9.1 Create the Pinecone index (check embedding dimension in docs)
- [ ] 9.2 Embedding helper (Google GenAI; verify current model name)
- [ ] 9.3 Upsert a user preference with `userId` metadata
- [ ] 9.4 Query preferences filtered by `userId`
- [ ] 9.5 Use retrieved preferences inside the planner node
- [ ] 9.6 Detect and save new preferences from chat

### Phase 10 - Booking agent
- [ ] 10.1 Detect "book it" intent
- [ ] 10.2 Verify wallet balance
- [ ] 10.3 Lock escrow
- [ ] 10.4 Generate PNR and hotel voucher
- [ ] 10.5 Atomic debit + ledger write
- [ ] 10.6 Emit step-by-step socket events, then `booking:success`
- [ ] 10.7 Low-balance path: offer Razorpay top-up for the shortfall
- [ ] 10.8 `Booking` model and "my trips" API

### Phase 11 - Frontend polish and tickets
- [ ] 11.1 Trip cards (flight, hotel, day plan)
- [ ] 11.2 Live agent-progress panel (HUD)
- [ ] 11.3 Booking progress UI
- [ ] 11.4 Boarding pass PDF with `jspdf`
- [ ] 11.5 Dark glassmorphism styling
- [ ] 11.6 Final README, demo video, deploy

---

## Definition of done (per step)

- Code runs and expected output is verified.
- I can explain the file in an interview (answer the "check your understanding" questions).
- Committed to my branch.
- No unused code, debug logs or secrets.

---

## Resume goal

The resume bullets for this project only become true when the matching phase is finished. Use this table to know when each claim is safe to write.

| Resume claim | Built in | Before you write it |
|---|---|---|
| Multi-agent LangGraph pipeline with intent routing and parallel fan-out/fan-in | Phase 8 | Graph must really run classifier + 3 parallel agents |
| Hybrid GraphRAG (Neo4j + Pinecone) | Phases 6 + 9 | Both stores must feed the planner |
| "Sub-5ms route optimization" | Phase 6 | Measure the query time yourself; write the number you actually get |
| Live data via MCP + Amadeus | Phase 7 | Say "live" only if real API calls back it; avoid "100%" |
| Virtual escrow wallet, atomic ledger, Razorpay test mode | Phases 5 + 10 | Atomic = real MongoDB transaction |
| Socket.IO token streaming, agent HUD, jsPDF boarding pass | Phases 4, 8, 11 | All three must work in the demo |

Tips:
- Replace any claim you cannot demo or measure. Interviewers will ask.
- Verify model names (`Llama 3.3 70B`, `text-embedding-004`) in current docs; they may be renamed or retired.
- Add the real GitHub and demo links only after deployment.
