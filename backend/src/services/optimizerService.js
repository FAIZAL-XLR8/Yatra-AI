import axios from "axios";
import neo4j from "neo4j-driver";
import { getNeo4jSession } from "../config/neo4j.js";
import { discoverAttractions } from "./attractionGraphService.js";
import Trip from "../models/Trip.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

// Days between two date strings, capped 1–7
function tripDays(departure, returnDate) {
  if (!departure || !returnDate) return 1;
  const diff = Math.round((new Date(returnDate) - new Date(departure)) / 86400000);
  return Math.max(1, Math.min(7, diff || 1));
}

// "570 mins" → "09:30 AM"
function toTime(mins) {
  const h24 = Math.floor((mins % 1440) / 60);
  const m   = (mins % 1440) % 60;
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
}

// ── Neo4j Graph Queries — the actual reason we use a graph DB ────────────────
//
// Both queries use the pre-computed [:ROAD_ROUTE] edges that were stored when
// the hotel was linked to the attraction graph (hotelGraphService.js).
// This avoids calling OSRM for every attraction — Neo4j already has the distances.

// Option A: N nearest attractions to the hotel (sorted by road distanceKm)
async function getNearestToHotel(hotelId, n = 6) {
  const session = getNeo4jSession();
  if (!session) return null;
  try {
    const res = await session.run(
      `MATCH (h:Hotel { id: $hotelId })-[r:ROAD_ROUTE]->(a:Attraction)
       RETURN a.id AS id, a.name AS name, a.latitude AS latitude,
              a.longitude AS longitude, a.category AS category,
              a.estVisitHours AS estVisitHours, r.distanceKm AS distanceKm
       ORDER BY r.distanceKm ASC
       LIMIT $n`,
      { hotelId, n: neo4j.int(n) }
    );
    return res.records.map(r => mapAttraction(r));
  } finally {
    await session.close();
  }
}

// Option B: All attractions within X km of the hotel
async function getWithinKmFromHotel(hotelId, km = 10) {
  const session = getNeo4jSession();
  if (!session) return null;
  try {
    const res = await session.run(
      `MATCH (h:Hotel { id: $hotelId })-[r:ROAD_ROUTE]->(a:Attraction)
       WHERE r.distanceKm <= $km
       RETURN a.id AS id, a.name AS name, a.latitude AS latitude,
              a.longitude AS longitude, a.category AS category,
              a.estVisitHours AS estVisitHours, r.distanceKm AS distanceKm
       ORDER BY r.distanceKm ASC`,
      { hotelId, km }
    );
    return res.records.map(r => mapAttraction(r));
  } finally {
    await session.close();
  }
}

// Helper: map a Neo4j record → plain JS object
function mapAttraction(r) {
  return {
    id: r.get("id"),
    name: r.get("name"),
    latitude: r.get("latitude"),
    longitude: r.get("longitude"),
    category: r.get("category"),
    estVisitHours: Number(r.get("estVisitHours")) || 2,
    distanceFromHotel: r.get("distanceKm")   // bonus — we get this free from the edge
  };
}

// Fallback: pull all attractions for city from Neo4j (no hotel filter)
async function getAttractions(city) {
  const session = getNeo4jSession();
  if (session) {
    try {
      const res = await session.run(
        `MATCH (a:Attraction) WHERE toLower(a.city) = $city
         RETURN a.id AS id, a.name AS name, a.latitude AS latitude,
                a.longitude AS longitude, a.category AS category, a.estVisitHours AS estVisitHours`,
        { city: city.trim().toLowerCase() }
      );
      const rows = res.records.map(r => ({
        id: r.get("id"), name: r.get("name"),
        latitude: r.get("latitude"), longitude: r.get("longitude"),
        category: r.get("category"), estVisitHours: Number(r.get("estVisitHours")) || 2
      }));
      if (rows.length) return rows;
    } finally {
      await session.close();
    }
  }
  return discoverAttractions(city);
}

// ── Core pipeline ─────────────────────────────────────────────────────────────

// Order stops by real road sequence using OSRM Trip API (free, no key)
async function orderByOSRM(stops) {
  if (stops.length <= 1) return stops;
  const coords = stops.map(s => `${s.longitude},${s.latitude}`).join(";");
  const { data } = await axios.get(
    `http://router.project-osrm.org/trip/v1/driving/${coords}?roundtrip=false&source=first`,
    { timeout: 8000 }
  );
  return stops
    .map((s, i) => ({ s, order: data.waypoints[i].waypoint_index }))
    .sort((a, b) => a.order - b.order)
    .map(x => x.s);
}

// Split ordered stops into days — new day when total hours would exceed limit
function splitDays(stops, maxHours = 8) {
  const days = [];
  let day = [], hrs = 0;
  for (const stop of stops) {
    const h = stop.estVisitHours || 2;
    if (day.length && hrs + h > maxHours) { days.push(day); day = []; hrs = 0; }
    day.push(stop); hrs += h;
  }
  if (day.length) days.push(day);
  return days;
}

// Build 09:30 AM timeline for a day's stops
function buildTimeline(dayStops) {
  const timeline = [];
  let clock = 570; // 09:30 AM in minutes
  for (const stop of dayStops) {
    timeline.push({ time: toTime(clock), event: `Visit ${stop.name}`, category: stop.category });
    clock += (stop.estVisitHours || 2) * 60;
    timeline.push({ time: toTime(clock), event: `Leave ${stop.name}` });
  }
  return timeline;
}

// ── Main export ───────────────────────────────────────────────────────────────
//
// mode = "nearest"  → picks the N closest attractions to the hotel from Neo4j
// mode = "within"   → picks all attractions within X km from the hotel
// mode = "all"      → no hotel filter, uses all attractions for the city (default)

export async function optimizeTripItinerary({ tripId, userId, mode = "all", n = 6, km = 10 }) {
  const trip = await Trip.findOne({ _id: tripId, userId });
  if (!trip) throw new Error("Trip not found or unauthorized.");

  const { destination, departureDate, returnDate } = trip.tripSpec;
  if (!destination) throw new Error("Destination is required.");

  const hotelId = trip.selectedHotel?.hotelId;

  // Step 1 — choose which attractions to include based on mode
  let attractions;

  if (mode === "nearest" && hotelId) {
    // Neo4j query: N nearest to hotel via stored [:ROAD_ROUTE] edges — zero OSRM calls here
    attractions = await getNearestToHotel(hotelId, n);
  } else if (mode === "within" && hotelId) {
    // Neo4j query: all within km radius via stored [:ROAD_ROUTE] edges — zero OSRM calls here
    attractions = await getWithinKmFromHotel(hotelId, km);
  }

  // Fallback to full city list if no hotel linked or mode = "all"
  if (!attractions || !attractions.length) {
    attractions = await getAttractions(destination);
  }

  if (!attractions.length) throw new Error(`No attractions found for "${destination}".`);

  // Step 2 — OSRM orders the filtered set optimally (called only once, on the small set)
  const ordered = await orderByOSRM(attractions);

  // Step 3 — split across trip days
  const numDays = tripDays(departureDate, returnDate);
  const sightsPerDay = Math.ceil(ordered.length / numDays);
  const clusters = Array.from({ length: numDays }, (_, i) =>
    ordered.slice(i * sightsPerDay, (i + 1) * sightsPerDay)
  ).filter(c => c.length);

  // Step 4 — build itinerary with timeline per day
  const days = clusters.map((stops, i) => ({
    day: i + 1,
    date: departureDate
      ? new Date(new Date(departureDate).getTime() + i * 86400000).toISOString().split("T")[0]
      : null,
    stops: stops.map(s => ({
      name: s.name, category: s.category,
      estVisitHours: s.estVisitHours,
      distanceFromHotel: s.distanceFromHotel ?? null
    })),
    timeline: buildTimeline(stops)
  }));

  const itinerary = {
    destination, totalDays: days.length,
    mode, generatedAt: new Date(), days
  };

  trip.itinerary = itinerary;
  trip.workflowStatus = "ITINERARY_FINALIZED";
  await trip.save();

  return itinerary;
}
