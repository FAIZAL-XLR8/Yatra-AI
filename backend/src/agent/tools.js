import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchFlights } from "../services/flightService.js";
import { searchTrains } from "../services/trainService.js";
import { searchHotels } from "../services/hotelService.js";
import { buildItinerary } from "../services/itineraryService.js";
import { loadDynamicMCPTools } from "./mcpClient.js";
import Trip from "../models/Trip.js";

/**
 * ── 1. Native Backend Service Tools ──────────────────────────────────────────
 */

export const searchFlightsTool = tool(
  async ({ origin, destination, departureDate, passengers = 1 }) => {
    try {
      const results = await searchFlights({ origin, destination, departureDate, passengers });
      if (!results || results.length === 0) {
        return JSON.stringify({ status: "empty", message: `No flights found from ${origin} to ${destination} on ${departureDate}.` });
      }
      return JSON.stringify({ status: "success", count: results.length, flights: results.slice(0, 5) });
    } catch (err) {
      return JSON.stringify({ status: "error", message: err.message });
    }
  },
  {
    name: "search_flights",
    description: "Search live commercial flights between two cities for a specific departure date.",
    schema: z.object({
      origin: z.string().describe("Departure city or airport code (e.g., Delhi, Mumbai, BLR)"),
      destination: z.string().describe("Arrival city or airport code (e.g., Goa, Jaipur, BOM)"),
      departureDate: z.string().describe("Date of travel in YYYY-MM-DD format"),
      passengers: z.number().default(1).describe("Number of adult passengers")
    })
  }
);

export const searchTrainsTool = tool(
  async ({ origin, destination, departureDate, passengers = 1 }) => {
    try {
      const results = await searchTrains({ origin, destination, departureDate, passengers });
      if (!results || results.length === 0) {
        return JSON.stringify({ status: "empty", message: `No direct trains found from ${origin} to ${destination} on ${departureDate}.` });
      }
      return JSON.stringify({ status: "success", count: results.length, trains: results.slice(0, 5) });
    } catch (err) {
      return JSON.stringify({ status: "error", message: err.message });
    }
  },
  {
    name: "search_trains",
    description: "Search live Indian Railways (IRCTC) trains between two cities or station codes.",
    schema: z.object({
      origin: z.string().describe("Origin city or station code (e.g., Delhi, NDLS)"),
      destination: z.string().describe("Destination city or station code (e.g., Jaipur, JP)"),
      departureDate: z.string().describe("Date of journey in YYYY-MM-DD format"),
      passengers: z.number().default(1).describe("Number of passengers")
    })
  }
);

export const searchHotelsTool = tool(
  async ({ destination, landmark, radiusKm = 6 }) => {
    try {
      const results = await searchHotels({ destination, landmark: landmark || null, radiusKm: Number(radiusKm) || 6, max: 8 });
      if (!results || results.length === 0) {
        return JSON.stringify({ status: "empty", message: `No hotels found in ${destination}.` });
      }
      return JSON.stringify({ status: "success", count: results.length, hotels: results.slice(0, 5) });
    } catch (err) {
      return JSON.stringify({ status: "error", message: err.message });
    }
  },
  {
    name: "search_hotels",
    description: "Search hotels in a destination city, optionally near a specific landmark.",
    schema: z.object({
      destination: z.string().describe("Destination city name (e.g., Jaipur, Goa)"),
      landmark: z.string().optional().describe("Optional landmark (e.g., Baga Beach, Hawa Mahal)"),
      radiusKm: z.number().default(6).describe("Search radius in km")
    })
  }
);

export const optimizeItineraryTool = tool(
  async ({ destination }) => {
    try {
      const days = await buildItinerary(destination);
      return JSON.stringify({ status: "success", city: destination, totalDays: days.length, itinerary: days });
    } catch (err) {
      return JSON.stringify({ status: "error", message: err.message });
    }
  },
  {
    name: "optimize_itinerary",
    description: "Generate a zero-backtracking, multi-day sightseeing itinerary using Neo4j and OSRM.",
    schema: z.object({
      destination: z.string().describe("Destination city to build the itinerary for")
    })
  }
);

export const getTripStatusTool = tool(
  async ({ tripId }) => {
    try {
      const trip = await Trip.findById(tripId);
      if (!trip) return JSON.stringify({ status: "not_found", message: "Trip session not found." });
      return JSON.stringify({
        status: "success",
        tripId: trip._id,
        workflowStatus: trip.workflowStatus,
        spec: trip.tripSpec,
        hasTransport: Boolean(trip.selectedTransport?.identifier),
        hasHotel: Boolean(trip.selectedHotel?.name),
        paymentStatus: trip.paymentStatus,
        hasItinerary: Boolean(trip.itinerary)
      });
    } catch (err) {
      return JSON.stringify({ status: "error", message: err.message });
    }
  },
  {
    name: "get_trip_status",
    description: "Retrieve current workflow stage and booking details for an existing trip ID.",
    schema: z.object({
      tripId: z.string().describe("The MongoDB trip ID")
    })
  }
);

export const nativeAgentTools = [
  searchFlightsTool,
  searchTrainsTool,
  searchHotelsTool,
  optimizeItineraryTool,
  getTripStatusTool
];

/**
 * Returns the combined set of native tools + dynamically discovered MCP tools.
 */
export async function getCompleteAgentTools() {
  const dynamicMCPTools = await loadDynamicMCPTools();
  return [...nativeAgentTools, ...dynamicMCPTools];
}
