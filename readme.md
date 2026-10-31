# Yatra AI

AI-powered travel planning platform. Not a chatbot that makes up prices — real APIs, real bookings, virtual wallet checkout.

---

## What It Does

User says: *"Delhi to Goa, Nov 15, 2 people"*

→ Searches live flights + trains in parallel  
→ User picks transport  
→ Searches hotels (city-wide or near a landmark like "Baga Beach")  
→ User picks hotel  
→ In background, builds a Neo4j map of tourist attractions with real driving distances  
→ Later: AI generates a zero-backtracking day-by-day itinerary and books everything from the wallet  

---

## Stack

| Layer | Tools |
|---|---|
| Backend | Node.js (ES Modules), Express, Mongoose |
| Databases | MongoDB Atlas, Neo4j |
| Auth | JWT in httpOnly cookie (anti-XSS, anti-CSRF) |
| Flights & Hotels | Amadeus Self-Service API |
| Trains | IRCTC via RapidAPI |
| Road Distances | OSRM (free, no key) |
| Geocoding | OpenStreetMap Nominatim (free, no key) |
| Frontend | React 19 + Vite + Tailwind v4 + DaisyUI + Framer Motion |

---

## What's Built

### Auth
- Register / Login / Logout with bcrypt + JWT httpOnly cookie
- Every user starts with ₹50,000 virtual wallet
- User stores travel preferences (budget tier, travel style, dietary)

### Trip State Machine (MongoDB)
Each trip moves through locked phases:
```
INPUT_VALIDATED → TRANSPORT_SEARCHED → TRANSPORT_SELECTED
→ HOTELS_SEARCHED → HOTEL_SELECTED → PAYMENT_PENDING
→ BOOKING_CONFIRMED → ITINERARY_FINALIZED
```
One `tripId` tracks everything. Refresh the page, trip resumes where you left off.

### Transport Search (Phase 1 & 2)
- Flights and trains searched **concurrently** via `Promise.allSettled` — one failure doesn't kill the other
- IATA resolver: "Bombay" → "BOM", "Bengaluru" → "BLR" — offline-first (7k airport dataset) with Amadeus API fallback
- Train station resolver: "Delhi" → `NDLS`, "Mumbai" → `CSMT`, etc.
- User picks one (HITL gate), selection saved with timestamp

### Hotel Discovery (Phase 3 & 4)
- City-wide search or landmark radius search (e.g., 6km from "Hawa Mahal")
- Amadeus hotel API → falls back to OpenStreetMap if no API keys
- User picks hotel (HITL gate)

### Neo4j Attraction Graph (Phase 3B — runs in background, non-blocking)
- Checks if city graph already exists in Neo4j (MongoDB registry as cache flag)
- Cache HIT: loads attractions from Neo4j instantly (0 API calls)
- Cache MISS: discovers attractions via OSM → OSRM real road routes → writes `(:Attraction)` nodes + `[:CAB_ROUTE]` edges to Neo4j
- Cab fare: `₹50 base + km × ₹15 + mins × ₹1` (from real OSRM distance, not approximation)

---

## Challenges

**ES Modules + CommonJS conflict** — `airport-data` package is CJS only. Had to use `createRequire(import.meta.url)` to import it inside an ES Module context.

**Amadeus hotel prices are missing** — `/hotels/by-city` returns only metadata, not rates. Live prices need a second `/shopping/hotel-offers` call per hotel. Placeholder price shown for now, real pricing comes in Phase 7 with the MCP hotel tool.

**OSRM pairwise routes are slow on first build** — 10 attractions = 90 individual OSRM calls. Runs in background so user isn't blocked. Neo4j caching means this only happens once per city.

**IRCTC fare returns null** — Some routes have `fare: null` depending on class availability. Stored and displayed as "price unavailable" for now.

---

## What's Next

| Phase | Work |
|---|---|
| 5 | Atomic wallet debit (MongoDB transaction) + Razorpay top-up |
| 6 | Restaurant nodes + `NEARBY_DINING` edges in Neo4j |
| 7 | Custom MCP server (Flights + Trains + Cab Fare) + public MCP for Weather + Maps |
| 8 | LangGraph agents: Classifier → Planner → Flight/Hotel/Itinerary → Streaming answer |
| 9 | Pinecone memory for user preferences across sessions |
| 10 | Booking agent: "book it" → escrow → PNR → debit → `booking:success` socket event |
| 11 | Frontend: Trip wizard UI, live agent HUD, jsPDF boarding pass, dark glassmorphism |

---

## Run Locally

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

Create `.env` from `.env.example`. MongoDB required. Neo4j optional — if `NEO4J_PASSWORD` is missing, graph operations are bypassed gracefully.

---

## Branches
- `main` — reviewed, stable only
- `anmol-dev` — my working branch

Never push directly to main.
