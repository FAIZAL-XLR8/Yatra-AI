import axios from "axios";
import { getNeo4jSession } from "../config/neo4j.js";
import {
  fetchLiveRoadRoute,
  buildAttractionKnowledgeGraph
} from "./attractionGraphService.js";
import Trip from "../models/Trip.js";

/**
 * Resolves hotel geographic coordinates via OpenStreetMap Nominatim live search
 * if coordinates were not provided during hotel selection.
 *
 * @param {string} hotelName
 * @param {string} city
 * @returns {Promise<{ latitude: number, longitude: number }|null>}
 */
export async function resolveHotelCoordinates(hotelName, city) {
  try {
    const query = `${hotelName}, ${city}`;
    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: query,
        format: "json",
        limit: 1
      },
      headers: {
        "User-Agent": "YatraAI/1.0 (hotel-graph-resolver; contact@yatra.ai)"
      },
      timeout: 7000
    });

    const item = response.data?.[0];
    if (item && item.lat && item.lon) {
      return {
        latitude: parseFloat(item.lat),
        longitude: parseFloat(item.lon)
      };
    }
  } catch (err) {
    console.warn(`[HotelGraph] Nominatim lookup failed for "${hotelName}, ${city}":`, err.message);
  }

  // Fallback: resolve city center coordinates
  try {
    const cityRes = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: { q: city, format: "json", limit: 1 },
      headers: { "User-Agent": "YatraAI/1.0 (city-resolver; contact@yatra.ai)" },
      timeout: 5000
    });
    const cityItem = cityRes.data?.[0];
    if (cityItem && cityItem.lat && cityItem.lon) {
      return {
        latitude: parseFloat(cityItem.lat),
        longitude: parseFloat(cityItem.lon)
      };
    }
  } catch (cityErr) {
    console.warn(`[HotelGraph] City center fallback lookup failed for "${city}":`, cityErr.message);
  }

  return null;
}

/**
 * Phase 6: Links Confirmed Hotel to the Reusable City Attraction Knowledge Graph in Neo4j.
 *
 * Workflow:
 * 1. Checks/resolves hotel coordinates.
 * 2. Merges the (:Hotel) node into Neo4j.
 * 3. Retrieves all city attractions from Neo4j (auto-building attraction graph if not yet created).
 * 4. Queries live OSRM turn-by-turn road routes from Hotel to each Attraction.
 * 5. Merges bidirectional [:ROAD_ROUTE] edges with real driving distance and duration from OSRM.
 * 6. Advances Trip workflow status to "HOTEL_GRAPH_LINKED".
 *
 * @param {Object} params
 * @param {string} params.tripId
 * @param {string} params.destinationCity
 * @param {string} params.hotelId
 * @param {string} params.hotelName
 * @param {number} [params.latitude]
 * @param {number} [params.longitude]
 * @returns {Promise<Object>} Summary of linked nodes and routes.
 */
export async function linkHotelToAttractionGraph({
  tripId,
  destinationCity,
  hotelId,
  hotelName,
  latitude,
  longitude
}) {
  if (!destinationCity || !hotelName) {
    throw new Error("destinationCity and hotelName are required to link hotel graph.");
  }

  const cleanCity = destinationCity.trim().toLowerCase();
  const cleanHotelId = String(hotelId || `hotel_${hotelName.toLowerCase().replace(/[^\w]/g, "_").slice(0, 24)}`);

  // 1. Resolve coordinates if missing
  let lat = latitude ? parseFloat(latitude) : null;
  let lon = longitude ? parseFloat(longitude) : null;

  if (isNaN(lat) || isNaN(lon) || !lat || !lon) {
    const resolved = await resolveHotelCoordinates(hotelName, destinationCity);
    if (!resolved || !resolved.latitude || !resolved.longitude) {
      throw new Error(
        `Unable to resolve geographic coordinates for hotel "${hotelName}" in "${destinationCity}". OpenStreetMap lookup failed.`
      );
    }
    lat = resolved.latitude;
    lon = resolved.longitude;
  }

  console.log(`[HotelGraph] Linking Hotel "${hotelName}" (${lat}, ${lon}) to "${destinationCity}" graph in Neo4j...`);

  const session = getNeo4jSession();
  if (!session) {
    console.warn("[HotelGraph] Neo4j session unavailable. Skipping graph edge creation.");
    return {
      hotelId: cleanHotelId,
      hotelName,
      city: destinationCity,
      latitude: lat,
      longitude: lon,
      attractionsLinked: 0,
      routesCreated: 0,
      neo4jSaved: false
    };
  }

  try {
    // 2. Upsert (:Hotel) Node in Neo4j
    const upsertHotelCypher = `
      MERGE (h:Hotel { id: $hotelId })
      SET h.name = $hotelName,
          h.city = $city,
          h.latitude = $latitude,
          h.longitude = $longitude,
          h.tripId = $tripId,
          h.updatedAt = datetime()
      RETURN h
    `;
    await session.run(upsertHotelCypher, {
      hotelId: cleanHotelId,
      hotelName,
      city: cleanCity,
      latitude: lat,
      longitude: lon,
      tripId: tripId ? String(tripId) : ""
    });

    // 3. Retrieve all city attractions from Neo4j
    const getAttractionsCypher = `
      MATCH (a:Attraction)
      WHERE toLower(a.city) = $city
      RETURN a.id AS id, a.name AS name, a.latitude AS latitude, a.longitude AS longitude
    `;
    let attrResult = await session.run(getAttractionsCypher, { city: cleanCity });
    let attractions = attrResult.records.map((r) => ({
      id: r.get("id"),
      name: r.get("name"),
      latitude: r.get("latitude"),
      longitude: r.get("longitude")
    }));

    // If city graph hasn't been built yet in Neo4j, build it dynamically now
    if (attractions.length === 0) {
      console.log(`[HotelGraph] No attractions in Neo4j for "${destinationCity}". Building attraction graph now...`);
      const built = await buildAttractionKnowledgeGraph(destinationCity);
      attractions = built.attractions || [];
    }

    if (attractions.length === 0) {
      console.warn(`[HotelGraph] Zero attractions found for "${destinationCity}". No routes to connect.`);
      return {
        hotelId: cleanHotelId,
        hotelName,
        city: destinationCity,
        latitude: lat,
        longitude: lon,
        attractionsLinked: 0,
        routesCreated: 0,
        neo4jSaved: true
      };
    }

    // 4. Calculate live OSRM road routes and merge bidirectional edges
    let routesCount = 0;
    const mergeRouteCypher = `
      MATCH (h:Hotel { id: $hotelId })
      MATCH (a:Attraction { id: $attractionId })
      MERGE (h)-[r1:ROAD_ROUTE]->(a)
      SET r1.distanceKm = $distanceKm,
          r1.durationMins = $durationMins
      MERGE (a)-[r2:ROAD_ROUTE]->(h)
      SET r2.distanceKm = $distanceKm,
          r2.durationMins = $durationMins
    `;

    for (const attr of attractions) {
      const { distanceKm, durationMins } = await fetchLiveRoadRoute(
        lat,
        lon,
        attr.latitude,
        attr.longitude
      );

      await session.run(mergeRouteCypher, {
        hotelId: cleanHotelId,
        attractionId: attr.id,
        distanceKm,
        durationMins
      });

      routesCount += 2; // Bidirectional: Hotel -> Attraction and Attraction -> Hotel
    }

    console.log(
      `[HotelGraph] Successfully linked Hotel "${hotelName}" to ${attractions.length} attractions with ${routesCount} road routes in Neo4j.`
    );

    // 5. Update Trip workflow status in MongoDB
    if (tripId) {
      const trip = await Trip.findById(tripId);
      if (trip) {
        trip.workflowStatus = "HOTEL_GRAPH_LINKED";
        if (trip.selectedHotel) {
          trip.selectedHotel.geoCode = { latitude: lat, longitude: lon };
        }
        await trip.save();
      }
    }

    return {
      hotelId: cleanHotelId,
      hotelName,
      city: destinationCity,
      latitude: lat,
      longitude: lon,
      attractionsLinked: attractions.length,
      routesCreated: routesCount,
      neo4jSaved: true
    };
  } catch (error) {
    console.error("[HotelGraph] Error linking hotel to Neo4j graph:", error.message);
    throw error;
  } finally {
    await session.close();
  }
}
