import axios from "axios";
import { getNeo4jSession } from "../config/neo4j.js";
import { discoverAttractions, getRoadRoute } from "./attractionGraphService.js";
import Trip from "../models/Trip.js";

// ─── Resolve hotel coordinates via OpenStreetMap ──────────────────────────────
async function resolveCoordinates(hotelName, city) {
  // Try hotel + city first, fall back to just city center
  for (const query of [`${hotelName}, ${city}`, city]) {
    try {
      const { data } = await axios.get("https://nominatim.openstreetmap.org/search", {
        params: { q: query, format: "json", limit: 1 },
        headers: { "User-Agent": "YatraAI/1.0" },
        timeout: 7000
      });
      if (data[0]?.lat && data[0]?.lon) {
        return { latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) };
      }
    } catch {}
  }
  return null;
}

// ─── Main: Link hotel to attractions in Neo4j ─────────────────────────────────
//
//  Graph schema (simple — hotel is the center, attractions are spokes):
//
//    (:Hotel { id, name, city, lat, lon })
//       -[:ROAD_ROUTE { distanceKm, durationMins }]->
//    (:Attraction { id, name, city, lat, lon, category, estVisitHours })
//
//  No attraction-to-attraction edges. The optimizer uses OSRM Trip API
//  to order attractions — Neo4j is only for hotel↔attraction distances.
//
export async function linkHotelToAttractions({ tripId, destinationCity, hotelId, hotelName, latitude, longitude }) {
  if (!destinationCity || !hotelName) throw new Error("destinationCity and hotelName are required.");

  // 1. Resolve hotel coordinates
  let lat = parseFloat(latitude), lon = parseFloat(longitude);
  if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
    const resolved = await resolveCoordinates(hotelName, destinationCity);
    if (!resolved) throw new Error(`Cannot resolve coordinates for "${hotelName}" in "${destinationCity}".`);
    lat = resolved.latitude;
    lon = resolved.longitude;
  }

  // 2. Discover attractions for this city via OpenStreetMap
  const attractions = await discoverAttractions(destinationCity);
  if (!attractions.length) throw new Error(`No attractions found for "${destinationCity}".`);

  // 3. Compute OSRM road distance from hotel to each attraction
  const edges = [];
  for (const attr of attractions) {
    const { distanceKm, durationMins } = await getRoadRoute(lat, lon, attr.latitude, attr.longitude);
    edges.push({ attractionId: attr.id, distanceKm, durationMins });
  }

  // 4. Write to Neo4j
  const cleanCity = destinationCity.trim().toLowerCase();
  const cleanHotelId = hotelId || `hotel_${hotelName.toLowerCase().replace(/\W/g, "_").slice(0, 24)}`;
  const session = getNeo4jSession();

  if (session) {
    try {
      // Upsert hotel node
      await session.run(
        `MERGE (h:Hotel { id: $id })
         SET h.name = $name, h.city = $city, h.latitude = $lat, h.longitude = $lon`,
        { id: cleanHotelId, name: hotelName, city: cleanCity, lat, lon }
      );

      // Upsert attraction nodes
      await session.run(
        `UNWIND $attractions AS a
         MERGE (n:Attraction { id: a.id })
         SET n.name = a.name, n.city = a.city, n.latitude = a.latitude, n.longitude = a.longitude,
             n.category = a.category, n.estVisitHours = a.estVisitHours`,
        { attractions }
      );

      // Create Hotel → Attraction edges with OSRM distances
      await session.run(
        `UNWIND $edges AS e
         MATCH (h:Hotel { id: $hotelId })
         MATCH (a:Attraction { id: e.attractionId })
         MERGE (h)-[r:ROAD_ROUTE]->(a)
         SET r.distanceKm = e.distanceKm, r.durationMins = e.durationMins`,
        { hotelId: cleanHotelId, edges }
      );

      console.log(`[HotelGraph] Linked "${hotelName}" → ${attractions.length} attractions in Neo4j`);
    } finally {
      await session.close();
    }
  }

  // 5. Update trip workflow in MongoDB
  if (tripId) {
    const trip = await Trip.findById(tripId);
    if (trip) {
      trip.workflowStatus = "HOTEL_GRAPH_LINKED";
      if (trip.selectedHotel) trip.selectedHotel.geoCode = { latitude: lat, longitude: lon };
      await trip.save();
    }
  }

  return {
    hotelId: cleanHotelId, hotelName, city: destinationCity,
    latitude: lat, longitude: lon,
    attractionsLinked: attractions.length,
    routesCreated: edges.length
  };
}
