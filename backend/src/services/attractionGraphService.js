import axios from "axios";
import { getNeo4jSession } from "../config/neo4j.js";
import CityGraph from "../models/CityGraph.js";

// ─── 1. Categorise a place based on its OSM type ─────────────────────────────
function categorise(osmType = "") {
  const t = osmType.toLowerCase();
  if (t.includes("fort") || t.includes("castle"))  return { category: "FORT",      estVisitHours: 2.5 };
  if (t.includes("museum"))                         return { category: "MUSEUM",    estVisitHours: 2.0 };
  if (t.includes("temple") || t.includes("church")) return { category: "TEMPLE",    estVisitHours: 1.5 };
  if (t.includes("monument") || t.includes("memorial")) return { category: "MONUMENT", estVisitHours: 1.5 };
  if (t.includes("beach"))                          return { category: "BEACH",     estVisitHours: 2.5 };
  return { category: "ATTRACTION", estVisitHours: 2.0 };
}

// ─── 2. Fetch attractions for a city from OpenStreetMap Nominatim ─────────────
export async function discoverAttractions(city) {
  const { data } = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: { q: `attractions in ${city}`, format: "json", limit: 10 },
    headers: { "User-Agent": "YatraAI/1.0" },
    timeout: 8000
  });

  const seen = new Set();
  const citySlug = city.toLowerCase().replace(/\W/g, "_");

  return data
    .filter(item => {
      const name = item.display_name?.split(",")[0]?.trim();
      if (!name || name.length < 3 || seen.has(name)) return false;
      seen.add(name);
      return !isNaN(parseFloat(item.lat)) && !isNaN(parseFloat(item.lon));
    })
    .map((item, i) => {
      const name = item.display_name.split(",")[0].trim();
      const { category, estVisitHours } = categorise(item.type);
      return {
        id: `${citySlug}_${name.toLowerCase().replace(/\W/g, "_").slice(0, 20)}_${i}`,
        name,
        city,
        latitude:  parseFloat(item.lat),
        longitude: parseFloat(item.lon),
        category,
        estVisitHours
      };
    });
}

// ─── 3. Get road distance + duration between two points via free OSRM API ─────
export async function getRoadRoute(fromLat, fromLon, toLat, toLon) {
  const url = `http://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=false`;
  const { data } = await axios.get(url, { timeout: 6000 });
  const route = data?.routes?.[0];
  if (!route) throw new Error("OSRM returned no route");
  return {
    distanceKm:  parseFloat((route.distance / 1000).toFixed(2)),
    durationMins: Math.max(1, Math.round(route.duration / 60))
  };
}

// ─── 4. Build the graph: nodes = attractions, edges = ROAD_ROUTE ──────────────
//
//  Graph schema in Neo4j:
//    (:Attraction { id, name, city, latitude, longitude, category, estVisitHours })
//    -[:ROAD_ROUTE { distanceKm, durationMins }]->
//    (:Attraction)
//
//  MongoDB CityGraph acts as a simple cache flag so we don't rebuild
//  the graph every time the same city is requested.
//
export async function buildAttractionGraph(city) {
  const normalizedCity = city.trim().toLowerCase();

  // Cache hit — graph already exists in Neo4j, skip expensive API calls
  const cached = await CityGraph.findOne({ city: normalizedCity, isGraphSaved: true });
  if (cached) {
    console.log(`[Graph] Cache HIT for "${city}" — ${cached.attractionsCount} nodes, ${cached.routesCount} edges`);
    return { fromCache: true, attractionsCount: cached.attractionsCount, routesCount: cached.routesCount };
  }

  // Cache miss — fetch attractions and compute pairwise road distances
  console.log(`[Graph] Cache MISS for "${city}" — fetching live data...`);
  const attractions = await discoverAttractions(city);
  if (!attractions.length) throw new Error(`No attractions found for "${city}"`);

  // Build all directed edges (A → B for every pair A ≠ B)
  const edges = [];
  for (const from of attractions) {
    for (const to of attractions) {
      if (from.id === to.id) continue;
      const { distanceKm, durationMins } = await getRoadRoute(
        from.latitude, from.longitude, to.latitude, to.longitude
      );
      edges.push({ fromId: from.id, toId: to.id, distanceKm, durationMins });
    }
  }

  // Write to Neo4j
  const session = getNeo4jSession();
  if (!session) {
    console.warn("[Graph] Neo4j unavailable — graph built in memory only");
    return { fromCache: false, attractionsCount: attractions.length, routesCount: edges.length };
  }

  try {
    // MERGE nodes
    await session.run(
      `UNWIND $attractions AS a
       MERGE (n:Attraction { id: a.id })
       SET n.name = a.name, n.city = a.city,
           n.latitude = a.latitude, n.longitude = a.longitude,
           n.category = a.category, n.estVisitHours = a.estVisitHours`,
      { attractions }
    );

    // MERGE edges with distanceKm + durationMins as relationship properties
    await session.run(
      `UNWIND $edges AS e
       MATCH (from:Attraction { id: e.fromId })
       MATCH (to:Attraction   { id: e.toId   })
       MERGE (from)-[r:ROAD_ROUTE]->(to)
       SET r.distanceKm = e.distanceKm, r.durationMins = e.durationMins`,
      { edges }
    );

    // Mark graph as saved in MongoDB so next request is a cache hit
    await CityGraph.findOneAndUpdate(
      { city: normalizedCity },
      { city: normalizedCity, isGraphSaved: true, attractionsCount: attractions.length, routesCount: edges.length, lastBuiltAt: new Date() },
      { upsert: true }
    );

    console.log(`[Graph] Saved ${attractions.length} nodes + ${edges.length} edges for "${city}"`);
    return { fromCache: false, attractionsCount: attractions.length, routesCount: edges.length };
  } finally {
    await session.close();
  }
}

// ─── 5. Read the graph back from Neo4j (for itinerary or debugging) ───────────
export async function getAttractionGraph(city) {
  const session = getNeo4jSession();
  if (!session) throw new Error("Neo4j unavailable");

  try {
    // Nodes
    const nodeRes = await session.run(
      `MATCH (a:Attraction) WHERE toLower(a.city) = $city
       RETURN a.id AS id, a.name AS name, a.category AS category,
              a.estVisitHours AS estVisitHours, a.latitude AS lat, a.longitude AS lon`,
      { city: city.trim().toLowerCase() }
    );
    const nodes = nodeRes.records.map(r => ({
      id: r.get("id"), name: r.get("name"), category: r.get("category"),
      estVisitHours: r.get("estVisitHours"), lat: r.get("lat"), lon: r.get("lon")
    }));

    // Edges
    const edgeRes = await session.run(
      `MATCH (a:Attraction)-[r:ROAD_ROUTE]->(b:Attraction)
       WHERE toLower(a.city) = $city
       RETURN a.id AS from, b.id AS to, r.distanceKm AS distanceKm, r.durationMins AS durationMins`,
      { city: city.trim().toLowerCase() }
    );
    const edges = edgeRes.records.map(r => ({
      from: r.get("from"), to: r.get("to"),
      distanceKm: r.get("distanceKm"), durationMins: r.get("durationMins")
    }));

    return { nodes, edges };
  } finally {
    await session.close();
  }
}
