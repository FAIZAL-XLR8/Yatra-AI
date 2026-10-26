import { searchFlights } from "./flightService.js";
import { searchTrains } from "./trainService.js";

/**
 * Phase 1: Transport Search Fan-Out / Fan-In
 * Runs live flight search and live train search concurrently.
 * Tolerates individual failures using Promise.allSettled.
 *
 * @param {Object} params
 * @param {string} params.origin - Origin city or station/airport code.
 * @param {string} params.destination - Destination city or station/airport code.
 * @param {string} params.departureDate - YYYY-MM-DD.
 * @param {number} [params.passengers=1] - Number of passengers.
 * @returns {Promise<{ flightResults: Array, trainResults: Array }>}
 */
export async function searchTransport({ origin, destination, departureDate, passengers = 1 }) {
  if (!origin || !destination || !departureDate) {
    throw new Error("origin, destination, and departureDate are required for transport search.");
  }

  // Fan-Out: Execute flight search and train search concurrently
  const [flightsOutcome, trainsOutcome] = await Promise.allSettled([
    searchFlights({ origin, destination, departureDate, passengers }),
    searchTrains({ origin, destination, departureDate, passengers })
  ]);

  // Fan-In: Merge and normalize results
  const flightResults =
    flightsOutcome.status === "fulfilled" && Array.isArray(flightsOutcome.value)
      ? flightsOutcome.value.slice(0, 10)
      : [];

  if (flightsOutcome.status === "rejected") {
    console.error("[TransportService] Flight search branch failed:", flightsOutcome.reason);
  }

  const trainResults =
    trainsOutcome.status === "fulfilled" && Array.isArray(trainsOutcome.value)
      ? trainsOutcome.value.slice(0, 10)
      : [];

  if (trainsOutcome.status === "rejected") {
    console.error("[TransportService] Train search branch failed:", trainsOutcome.reason);
  }

  return {
    flightResults,
    trainResults
  };
}
