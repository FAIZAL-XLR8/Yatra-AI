import { createRequire } from "module";
import axios from "axios";

const require = createRequire(import.meta.url);
const rawAirportData = require("airport-data");

/**
 * In-memory runtime IATA cache.
 * Key: normalized city or airport name (lowercase, trimmed)
 * Value: 3-letter uppercase IATA code (e.g. "DEL", "BOM")
 */
const iataCache = new Map();

/**
 * Common city name aliases for modern vs historical Indian city names.
 */
const CITY_ALIASES = {
  bengaluru: "bangalore",
  bombay: "mumbai",
  calcutta: "kolkata",
  madras: "chennai",
  trivandrum: "thiruvananthapuram",
  cochin: "kochi",
  poona: "pune",
  baroda: "vadodara",
  orissa: "bhubaneswar",
  pondicherry: "puducherry",
  vizag: "visakhapatnam"
};

/**
 * Build fast lookup indexes from the airport-data package (7,184 global airports, 125 Indian airports).
 */
const datasetIndex = new Map();

function buildDatasetIndex() {
  if (!Array.isArray(rawAirportData)) return;



  // Only pass: Indian airports take precedence for matching city/state names
  for (const airport of rawAirportData) {
    if (!airport.iata || airport.iata.length !== 3 || airport.country !== "India") continue;
    const iata = airport.iata.toUpperCase();

    if (airport.city) {
      const cityKey = airport.city.toLowerCase().trim();
      datasetIndex.set(cityKey, iata);
    }
    if (airport.name) {
      const nameKey = airport.name.toLowerCase().trim();
      datasetIndex.set(nameKey, iata);
    }
  }
}

buildDatasetIndex();

/**
 * Normalizes input string for reliable cache matching.
 * E.g. " New Delhi, India " -> "delhi"
 */
function normalizeQuery(input) {
  if (!input || typeof input !== "string") return "";
  let cleaned = input
    .toLowerCase()
    .replace(/,\s*india$/i, "") // strip trailing ", India"
    .replace(/[^\w\s]/gi, " ")   // replace punctuation with space
    .replace(/\s+/g, " ")        // collapse multi-spaces
    .trim();

  // Map known aliases (e.g. bengaluru -> bangalore)
  if (CITY_ALIASES[cleaned]) {
    cleaned = CITY_ALIASES[cleaned];
  }

  return cleaned;
}

/**
 * Resolves a city or airport name into a valid 3-letter IATA code.
 *
 * Multi-tier resolution:
 * 1. 3-letter code check.
 * 2. In-memory runtime cache lookup (0ms).
 * 3. Offline airport-data package lookup (0ms, 7,184 airports).
 * 4. Amadeus Reference Data Locations API lookup if missing from dataset.
 * 5. Add to cache immediately upon finding the result.
 * 6. Returns null if city has no commercial airport (never defaults to DEL).
 *
 * @param {string} cityOrAirport - Name of city, airport, or IATA code.
 * @param {string|null} amadeusAccessToken - Valid Amadeus OAuth bearer token.
 * @returns {Promise<string|null>} - 3-letter IATA code or null.
 */
export async function resolveIataCode(cityOrAirport, amadeusAccessToken = null) {
  if (!cityOrAirport || typeof cityOrAirport !== "string") {
    return null;
  }

  const rawTrimmed = cityOrAirport.trim();

  // 1. If already a 3-letter uppercase IATA code, return it directly
  if (/^[A-Za-z]{3}$/.test(rawTrimmed)) {
    return rawTrimmed.toUpperCase();
  }

  const normalized = normalizeQuery(rawTrimmed);
  if (!normalized) return null;

  // 2. Runtime Cache Hit
  if (iataCache.has(normalized)) {
    return iataCache.get(normalized);
  }

  // 3. Lookup in airport-data package index
  if (datasetIndex.has(normalized)) {
    const code = datasetIndex.get(normalized);
    iataCache.set(normalized, code);
    return code;
  }

  // Check prefix or partial match in dataset index (e.g. "delhi ncr" -> "delhi", "mumbai international" -> "mumbai")
  for (const [key, code] of datasetIndex.entries()) {
    if (normalized.startsWith(`${key} `) || normalized.endsWith(` ${key}`)) {
      iataCache.set(normalized, code);
      return code;
    }
  }

  // 4. Cache Miss + Dataset Miss: Query Amadeus Reference Data Locations API
  if (!amadeusAccessToken) {
    return null;
  }

  try {
    const url = "https://test.api.amadeus.com/v1/reference-data/locations";
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${amadeusAccessToken}`
      },
      params: {
        subType: "AIRPORT,CITY",
        keyword: normalized.toUpperCase(),
        "page[limit]": 5
      },
      timeout: 5000
    });

    const locations = response.data?.data;
    if (Array.isArray(locations) && locations.length > 0) {
      const match = locations.find((loc) => Boolean(loc.iataCode));
      if (match?.iataCode) {
        const foundIata = match.iataCode.toUpperCase();
        // 5. Add to cache if not present after getting API result
        iataCache.set(normalized, foundIata);
        console.log(`[IATA Resolver] Cache MISS resolved via Amadeus API: "${normalized}" -> ${foundIata}. Stored in cache.`);
        return foundIata;
      }
    }

    // No commercial airport found for this location (e.g., hill stations, remote villages)
    console.log(`[IATA Resolver] No commercial airport found for: "${normalized}".`);
    return null;
  } catch (err) {
    console.warn(`[IATA Resolver] Failed to resolve IATA for "${normalized}" via Amadeus API:`, err.message);
    return null;
  }
}

/**
 * Returns cache size and diagnostic metrics
 */
export function getIataCacheStats() {
  return {
    runtimeCacheSize: iataCache.size,
    indexedAirportsCount: datasetIndex.size
  };
}
