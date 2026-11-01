import { getNeo4jSession } from "../config/neo4j.js";

// 1. Fetch attractions for a city from Neo4j
export async function getAttractionsFromNeo4j(city) {
  const session = getNeo4jSession();
  if (!session) return [];

  try {
    const normalizedCity = city.trim().toLowerCase();
    const cypher = `
      MATCH (a:Attraction)
      WHERE toLower(a.city) = $city
      RETURN a.id AS id, a.name AS name, a.latitude AS latitude,
             a.longitude AS longitude, a.category AS category, a.estVisitHours AS estVisitHours
    `;
    const result = await session.run(cypher, { city: normalizedCity });
    return result.records.map((r) => ({
      id: r.get("id"),
      name: r.get("name"),
      latitude: r.get("latitude"),
      longitude: r.get("longitude"),
      category: r.get("category"),
      estVisitHours: Number(r.get("estVisitHours")) || 2
    }));
  } finally {
    await session.close();
  }
}

// 2. Order stops using the OSRM Trip API
export async function orderStops(stops) {
  if (!stops || stops.length <= 1) return stops || [];

  // OSRM expects longitude,latitude pairs separated by semicolons
  const coords = stops.map((s) => `${s.longitude},${s.latitude}`).join(";");
  const url = `https://router.project-osrm.org/trip/v1/driving/${coords}?roundtrip=false&source=first`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OSRM request failed with status ${res.status}`);
  }

  const data = await res.json();
  if (!data.waypoints) {
    throw new Error("Invalid OSRM response");
  }

  // Sort stops according to OSRM waypoint_index
  return stops
    .map((stop, i) => ({ stop, order: data.waypoints[i].waypoint_index }))
    .sort((a, b) => a.order - b.order)
    .map((item) => item.stop);
}

// 3. Split ordered stops into days based on visiting hours
export function splitIntoDays(orderedStops, maxHours = 8) {
  const days = [];
  let currentDay = [];
  let currentHours = 0;

  for (const stop of orderedStops) {
    const hours = stop.estVisitHours || 2;
    if (currentDay.length > 0 && currentHours + hours > maxHours) {
      days.push(currentDay);
      currentDay = [];
      currentHours = 0;
    }
    currentDay.push(stop);
    currentHours += hours;
  }

  if (currentDay.length > 0) {
    days.push(currentDay);
  }

  return days;
}

// Main function: calls all 3 steps to generate the itinerary
export async function buildItinerary(city) {
  const attractions = await getAttractionsFromNeo4j(city);
  if (!attractions || attractions.length === 0) {
    const error = new Error("No attractions found for this city");
    error.status = 404;
    throw error;
  }

  let ordered;
  try {
    ordered = await orderStops(attractions);
  } catch (err) {
    const error = new Error("Failed to optimize route via OSRM");
    error.status = 502;
    throw error;
  }

  return splitIntoDays(ordered);
}
