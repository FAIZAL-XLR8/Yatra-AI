import axios from "axios";
import { getAmadeusToken } from "./flightService.js";
import { resolveIataCode } from "./iataResolver.js";

/**
 * Geocodes a landmark within a destination city using OpenStreetMap Nominatim.
 * 100% FREE. Zero cost, no API key required.
 *
 * @param {string} landmark - e.g. "Baga Beach" or "Hawa Mahal"
 * @param {string} [city=""] - e.g. "Goa" or "Jaipur"
 * @returns {Promise<{ latitude: number, longitude: number } | null>}
 */
export async function geocodeLandmark(landmark, city = "") {
  if (!landmark || typeof landmark !== "string") return null;

  try {
    const query = city ? `${landmark}, ${city}` : landmark;
    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: query,
        format: "json",
        limit: 1
      },
      headers: {
        "User-Agent": "YatraAI/1.0 (travel-planner-app; contact@yatra.ai)"
      },
      timeout: 5000
    });

    const results = response.data;
    if (Array.isArray(results) && results.length > 0) {
      const { lat, lon } = results[0];
      return {
        latitude: parseFloat(lat),
        longitude: parseFloat(lon)
      };
    }

    return null;
  } catch (error) {
    console.warn(`[HotelService] Geocoding failed for landmark "${landmark}":`, error.message);
    return null;
  }
}

/**
 * 100% FREE OpenStreetMap Hotel Discovery.
 * Used when no Amadeus API credentials are provided. Zero cost, no API keys needed.
 */
export async function searchOpenStreetMapHotels({ destination, landmark = null, radiusKm = 6, max = 20 }) {
  const query = landmark
    ? `hotels near ${landmark}, ${destination}`
    : `hotels in ${destination}`;

  try {
    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: query,
        format: "json",
        limit: max
      },
      headers: {
        "User-Agent": "YatraAI/1.0 (travel-planner-app; contact@yatra.ai)"
      },
      timeout: 8000
    });

    const results = response.data || [];
    const normalizedHotels = [];
    const seenNames = new Set();

    for (let i = 0; i < results.length; i++) {
      const item = results[i];
      const rawName = item.display_name?.split(",")[0]?.trim();

      if (!rawName || rawName.length < 3 || seenNames.has(rawName.toLowerCase())) {
        continue;
      }
      seenNames.add(rawName.toLowerCase());

      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      if (isNaN(lat) || isNaN(lon)) continue;

      const slug = rawName.toLowerCase().replace(/[^\w]/g, "_").slice(0, 20);

      normalizedHotels.push({
        hotelId: `osm_${slug}_${i + 1}`,
        name: rawName,
        chainCode: null,
        iataCode: null,
        location: item.display_name,
        geoCode: {
          latitude: lat,
          longitude: lon
        },
        starRating: 4,
        pricePerNightInr: 3200,
        totalPriceInr: 3200,
        providerReference: "OPENSTREETMAP",
        landmarkContext: landmark ? { landmark, radiusKm } : null
      });
    }

    return normalizedHotels;
  } catch (error) {
    console.warn("[HotelService] OpenStreetMap hotel discovery error:", error.message);
    return [];
  }
}

/**
 * Searches up to 20 hotels across a destination city.
 * Uses Amadeus if keys are present; seamlessly falls back to 100% FREE OpenStreetMap.
 *
 * @param {Object} params
 * @param {string} params.destination - City name or IATA code.
 * @param {number} [params.max=20] - Maximum hotels to return.
 * @returns {Promise<Array>} Normalized array of up to 20 hotels.
 */
export async function searchCityHotels({ destination, max = 20 }) {
  const token = await getAmadeusToken();

  // If Amadeus credentials are not present, use 100% FREE OpenStreetMap discovery
  if (!token) {
    console.log(`[HotelService] Using 100% FREE OpenStreetMap hotel discovery for "${destination}"...`);
    return searchOpenStreetMapHotels({ destination, max });
  }

  const cityCode = await resolveIataCode(destination, token);
  if (!cityCode) {
    return searchOpenStreetMapHotels({ destination, max });
  }

  try {
    const url = "https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-city";
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      params: {
        cityCode,
        radius: 30,
        radiusUnit: "KM",
        hotelSource: "ALL"
      },
      timeout: 10000
    });

    const rawHotels = response.data?.data || [];
    const normalized = normalizeHotels(rawHotels, max);

    // If Amadeus returns 0 hotels for this city, fall back to OpenStreetMap
    if (normalized.length === 0) {
      return searchOpenStreetMapHotels({ destination, max });
    }

    return normalized;
  } catch (error) {
    console.warn(`[HotelService] Amadeus hotel search failed, falling back to 100% FREE OpenStreetMap:`, error.message);
    return searchOpenStreetMapHotels({ destination, max });
  }
}

/**
 * Searches up to 20 hotels within a specific radius of a landmark.
 *
 * @param {Object} params
 * @param {string} params.landmark - e.g. "Baga Beach"
 * @param {string} params.destination - Destination city
 * @param {number} [params.radiusKm=6] - Radius in kilometers (default 6 km)
 * @param {number} [params.max=20] - Maximum hotels to return.
 * @returns {Promise<Array>} Normalized array of hotels within the landmark radius.
 */
export async function searchLandmarkHotels({ landmark, destination, radiusKm = 6, max = 20 }) {
  const token = await getAmadeusToken();

  // If no Amadeus token, use 100% FREE OpenStreetMap landmark hotel discovery
  if (!token) {
    console.log(`[HotelService] Using 100% FREE OpenStreetMap landmark hotel discovery near "${landmark}"...`);
    return searchOpenStreetMapHotels({ destination, landmark, radiusKm, max });
  }

  const coordinates = await geocodeLandmark(landmark, destination);
  if (!coordinates) {
    return searchOpenStreetMapHotels({ destination, landmark, radiusKm, max });
  }

  try {
    const url = "https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-geocode";
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      params: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        radius: Math.max(1, Number(radiusKm) || 6),
        radiusUnit: "KM",
        hotelSource: "ALL"
      },
      timeout: 10000
    });

    const rawHotels = response.data?.data || [];
    const normalized = normalizeHotels(rawHotels, max, { landmark, radiusKm, coordinates });

    if (normalized.length === 0) {
      return searchOpenStreetMapHotels({ destination, landmark, radiusKm, max });
    }

    return normalized;
  } catch (error) {
    console.warn(`[HotelService] Amadeus landmark search failed, falling back to 100% FREE OpenStreetMap:`, error.message);
    return searchOpenStreetMapHotels({ destination, landmark, radiusKm, max });
  }
}

/**
 * Normalizes raw Amadeus hotel objects into the standard Yatra AI schema.
 */
function normalizeHotels(rawHotels, max = 20, landmarkContext = null) {
  if (!Array.isArray(rawHotels)) return [];

  const normalized = [];

  for (const hotel of rawHotels) {
    if (normalized.length >= max) break;

    const hotelId = hotel.hotelId ? String(hotel.hotelId).trim() : null;
    const name = hotel.name ? String(hotel.name).trim() : null;

    if (!hotelId || !name) continue;

    const latitude = hotel.geoCode?.latitude ? Number(hotel.geoCode.latitude) : null;
    const longitude = hotel.geoCode?.longitude ? Number(hotel.geoCode.longitude) : null;
    const address = Array.isArray(hotel.address?.lines)
      ? hotel.address.lines.join(", ")
      : hotel.address?.countryCode || null;

    const starRating = hotel.rating ? Number(hotel.rating) : 3;

    normalized.push({
      hotelId,
      name,
      chainCode: hotel.chainCode || null,
      iataCode: hotel.iataCode || null,
      location: address,
      geoCode: {
        latitude,
        longitude
      },
      starRating,
      pricePerNightInr: 3200,
      totalPriceInr: 3200,
      providerReference: "AMADEUS",
      landmarkContext: landmarkContext
        ? {
            landmark: landmarkContext.landmark,
            radiusKm: landmarkContext.radiusKm
          }
        : null
    });
  }

  return normalized;
}

/**
 * Unified Hotel Discovery entry point (Node 3A):
 * - If landmark is specified, searches within radius of landmark.
 * - Otherwise, searches up to 20 hotels across destination city.
 */
export async function searchHotels({ destination, landmark = null, radiusKm = 6, max = 20 }) {
  if (!destination) {
    throw new Error("destination is required for hotel search.");
  }

  if (landmark && typeof landmark === "string" && landmark.trim().length > 0) {
    return searchLandmarkHotels({ landmark: landmark.trim(), destination, radiusKm, max });
  }

  return searchCityHotels({ destination, max });
}
