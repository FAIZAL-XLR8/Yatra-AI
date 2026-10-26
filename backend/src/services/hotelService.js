import axios from "axios";
import { getAmadeusToken } from "./flightService.js";
import { resolveIataCode } from "./iataResolver.js";

/**
 * Geocodes a landmark within a destination city using OpenStreetMap Nominatim.
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
        "User-Agent": "YatraAI/1.0 (travel-planner-app)"
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
 * Searches up to 20 hotels across a destination city using Amadeus Hotels by City API.
 *
 * @param {Object} params
 * @param {string} params.destination - City name or IATA code.
 * @param {number} [params.max=20] - Maximum hotels to return.
 * @returns {Promise<Array>} Normalized array of up to 20 hotels.
 */
export async function searchCityHotels({ destination, max = 20 }) {
  const token = await getAmadeusToken();
  if (!token) {
    console.warn("[HotelService] Missing Amadeus credentials. Returning empty hotel results.");
    return [];
  }

  const cityCode = await resolveIataCode(destination, token);
  if (!cityCode) {
    console.log(`[HotelService] Unable to resolve IATA city code for destination="${destination}".`);
    return [];
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
    return normalizeHotels(rawHotels, max);
  } catch (error) {
    console.error(
      `[HotelService] Hotel search failed for city ${cityCode}:`,
      error.response?.data?.errors || error.message
    );
    return [];
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
  if (!token) {
    console.warn("[HotelService] Missing Amadeus credentials. Returning empty landmark hotel results.");
    return [];
  }

  const coordinates = await geocodeLandmark(landmark, destination);
  if (!coordinates) {
    console.log(`[HotelService] Could not resolve coordinates for landmark="${landmark}" in "${destination}".`);
    return [];
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
    return normalizeHotels(rawHotels, max, { landmark, radiusKm, coordinates });
  } catch (error) {
    console.error(
      `[HotelService] Landmark hotel search failed for ${landmark}:`,
      error.response?.data?.errors || error.message
    );
    return [];
  }
}

/**
 * Normalizes raw Amadeus hotel objects into the standard Yatra AI schema.
 * Strictly uses real API data; discards malformed records.
 */
function normalizeHotels(rawHotels, max = 20, landmarkContext = null) {
  if (!Array.isArray(rawHotels)) return [];

  const normalized = [];

  for (const hotel of rawHotels) {
    if (normalized.length >= max) break;

    const hotelId = hotel.hotelId ? String(hotel.hotelId).trim() : null;
    const name = hotel.name ? String(hotel.name).trim() : null;

    // Discard records without an ID or Name
    if (!hotelId || !name) continue;

    const latitude = hotel.geoCode?.latitude ? Number(hotel.geoCode.latitude) : null;
    const longitude = hotel.geoCode?.longitude ? Number(hotel.geoCode.longitude) : null;
    const address = Array.isArray(hotel.address?.lines)
      ? hotel.address.lines.join(", ")
      : hotel.address?.countryCode || null;

    const starRating = hotel.rating ? Number(hotel.rating) : null;

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
      pricePerNightInr: null, // Populated when pricing offers are queried
      totalPriceInr: null,
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
