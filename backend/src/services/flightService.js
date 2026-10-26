import axios from "axios";
import { config } from "../config/env.js";
import { resolveIataCode } from "./iataResolver.js";

// Cached OAuth token for Amadeus
let cachedToken = null;
let tokenExpiryTime = 0;

/**
 * Retrieves a valid OAuth 2.0 access token for Amadeus Self-Service API.
 * Automatically caches token until 60 seconds before expiration.
 */
export async function getAmadeusToken() {
  const { amadeusClientId, amadeusClientSecret } = config;

  if (!amadeusClientId || !amadeusClientSecret) {
    console.warn(
      "[FlightService] AMADEUS_CLIENT_ID or AMADEUS_CLIENT_SECRET is missing in .env. Live flight search will return empty."
    );
    return null;
  }

  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiryTime) {
    return cachedToken;
  }

  try {
    const response = await axios.post(
      "https://test.api.amadeus.com/v1/security/oauth2/token",
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: amadeusClientId,
        client_secret: amadeusClientSecret
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 8000
      }
    );

    const { access_token, expires_in } = response.data;
    cachedToken = access_token;
    // Buffer expiration by 60 seconds
    tokenExpiryTime = Date.now() + (expires_in - 60) * 1000;

    return cachedToken;
  } catch (error) {
    console.error("[FlightService] Error obtaining Amadeus OAuth token:", error.response?.data || error.message);
    return null;
  }
}

export async function searchFlights({ origin, destination, departureDate, passengers = 1 }) {
  const token = await getAmadeusToken();

  // 1. Resolve IATA codes with caching + API fallback
  const originIata = await resolveIataCode(origin, token);
  const destIata = await resolveIataCode(destination, token);

  if (!originIata || !destIata) {
    console.log(
      `[FlightService] Skipping flight search: Unable to resolve airport IATA code for origin="${origin}" (${originIata || "none"}) or destination="${destination}" (${destIata || "none"}).`
    );
    return [];
  }

  if (originIata === destIata) {
    console.log(`[FlightService] Origin and destination resolve to the same airport (${originIata}). Returning empty flights.`);
    return [];
  }

  // If no API token configured, return empty gracefully without crashing
  if (!token) {
    return [];
  }

  try {
    const url = "https://test.api.amadeus.com/v2/shopping/flight-offers";
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      params: {
        originLocationCode: originIata,
        destinationLocationCode: destIata,
        departureDate,
        adults: Math.max(1, Number(passengers) || 1),
        max: 10,
        currencyCode: "INR"
      },
      timeout: 10000
    });

    const flightOffers = response.data?.data || [];
    const carriers = response.data?.dictionaries?.carriers || {};

    // Filter and normalize valid flight offers (up to 10) using strictly real API data
    const normalizedFlights = [];

    for (const offer of flightOffers) {
      if (normalizedFlights.length >= 10) break;

      const firstItinerary = offer.itineraries?.[0];
      const segments = firstItinerary?.segments;
      if (!Array.isArray(segments) || segments.length === 0) continue;

      const firstSegment = segments[0];
      const lastSegment = segments[segments.length - 1];

      const carrierCode = firstSegment?.carrierCode;
      const departureTime = firstSegment?.departure?.at;
      const arrivalTime = lastSegment?.arrival?.at;

      // Discard any offer that does not have real carrier and flight times from the API
      if (!carrierCode || !departureTime || !arrivalTime) continue;

      const flightNumber = firstSegment.number
        ? `${carrierCode}-${firstSegment.number}`
        : carrierCode;
      const operatorName = carriers[carrierCode] || carrierCode;
      const duration = firstItinerary?.duration || null;
      const stops = Math.max(0, segments.length - 1);
      const priceInr = Math.round(Number(offer.price?.total || 0));
      const cabinClass =
        offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin || null;

      normalizedFlights.push({
        id: String(offer.id),
        type: "FLIGHT",
        providerReference: "AMADEUS",
        carrier: carrierCode,
        operatorName,
        identifier: flightNumber,
        flightNumber,
        origin: originIata,
        destination: destIata,
        departureTime,
        arrivalTime,
        duration,
        stops,
        priceInr,
        cabinClass
      });
    }

    return normalizedFlights;
  } catch (error) {
    console.error(
      `[FlightService] Flight search failed for ${originIata}->${destIata} on ${departureDate}:`,
      error.response?.data?.errors || error.message
    );
    return [];
  }
}
