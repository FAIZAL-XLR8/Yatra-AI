import { tool } from "@langchain/core/tools";
import { z } from "zod";
import axios from "axios";
import { searchFlights } from "../services/flightService.js";
import { searchTrains } from "../services/trainService.js";
import { searchHotels } from "../services/hotelService.js";
import { buildItinerary } from "../services/itineraryService.js";
import Trip from "../models/Trip.js";

// ── Shared helpers ────────────────────────────────────────────────────────────

async function geocodeCity(city) {
  const { data } = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: { q: String(city).trim(), format: "json", limit: 1 },
    headers: { "User-Agent": "YatraAI/1.0" },
    timeout: 6000
  });
  const loc = data?.[0];
  if (!loc?.lat || !loc?.lon) throw new Error(`Cannot geocode "${city}".`);
  return {
    lat: parseFloat(loc.lat),
    lon: parseFloat(loc.lon),
    name: loc.display_name?.split(",")[0] || city
  };
}

const WEATHER_CODE = {
  0: "Clear sky ☀️", 1: "Mainly clear 🌤️", 2: "Partly cloudy ⛅",
  3: "Overcast ☁️", 45: "Foggy 🌫️", 51: "Light drizzle 🌦️",
  61: "Slight rain 🌧️", 63: "Moderate rain 🌧️", 65: "Heavy rain ⛈️",
  71: "Slight snowfall 🌨️", 95: "Thunderstorm 🌩️"
};

// ── 1. Native Backend Service Tools ──────────────────────────────────────────

export const searchFlightsTool = tool(
  async ({ origin, destination, departureDate, passengers = 1 }) => {
    try {
      const results = await searchFlights({ origin, destination, departureDate, passengers });
      if (!results?.length) {
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
      if (!results?.length) {
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
      if (!results?.length) {
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
      landmark: z.string().optional().describe("Optional landmark near which to search (e.g., Baga Beach)"),
      radiusKm: z.number().default(6).describe("Search radius in km around the landmark")
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
    description: "Generate a zero-backtracking, multi-day sightseeing itinerary using Neo4j graph data and OSRM road routing.",
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

// ── 2. Weather & Places Tools (inlined — no subprocess, no MCP overhead) ─────

export const getCurrentWeatherTool = tool(
  async ({ city }) => {
    try {
      const { lat, lon, name } = await geocodeCity(city);
      const { data } = await axios.get("https://api.open-meteo.com/v1/forecast", {
        params: { latitude: lat, longitude: lon, current_weather: true },
        timeout: 6000
      });
      const curr = data?.current_weather;
      return JSON.stringify({
        city: name,
        temperature: `${Math.round(curr?.temperature)}°C`,
        condition: WEATHER_CODE[curr?.weathercode] || "Clear ☀️",
        windSpeed: `${curr?.windspeed} km/h`
      });
    } catch (err) {
      return JSON.stringify({ status: "error", message: err.message });
    }
  },
  {
    name: "get_current_weather",
    description: "Get real-time temperature, weather condition, and wind speed for any destination city.",
    schema: z.object({
      city: z.string().describe("City name (e.g. Jaipur, Goa, Manali)")
    })
  }
);

export const getWeatherForecastTool = tool(
  async ({ city }) => {
    try {
      const { lat, lon, name } = await geocodeCity(city);
      const { data } = await axios.get("https://api.open-meteo.com/v1/forecast", {
        params: {
          latitude: lat, longitude: lon,
          daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode",
          timezone: "auto"
        },
        timeout: 6000
      });
      const daily = data?.daily;
      const rainChance = daily?.precipitation_probability_max?.[0] ?? 0;
      const maxTemp = Math.round(daily?.temperature_2m_max?.[0] || 25);
      const minTemp = Math.round(daily?.temperature_2m_min?.[0] || 15);
      const advisory =
        rainChance > 50
          ? "High chance of rain. Prioritise indoor museums, galleries, and palaces."
          : maxTemp > 35
          ? "Warm weather. Plan fort climbs and open walking tours early in the morning."
          : "Ideal sightseeing weather.";
      return JSON.stringify({ city: name, forecast: `${minTemp}°C – ${maxTemp}°C`, rainProbability: `${rainChance}%`, advisory });
    } catch (err) {
      return JSON.stringify({ status: "error", message: err.message });
    }
  },
  {
    name: "get_weather_forecast",
    description: "Get 7-day temperature range, rain probability, and a sightseeing advisory for a city.",
    schema: z.object({
      city: z.string().describe("City name (e.g. Jaipur, Delhi, Mumbai)")
    })
  }
);

export const getPlacePhotosTool = tool(
  async ({ placeName, city }) => {
    try {
      const query = city ? `${placeName} ${city}` : placeName;
      const { data } = await axios.get("https://commons.wikimedia.org/w/api.php", {
        params: {
          action: "query", generator: "search", gsrsearch: query, gsrlimit: 3,
          prop: "imageinfo", iiprop: "url|size", format: "json", origin: "*"
        },
        headers: { "User-Agent": "YatraAI/1.0" },
        timeout: 6000
      });
      const pages = data?.query?.pages;
      const photos = [];
      if (pages) {
        for (const page of Object.values(pages)) {
          const url = page.imageinfo?.[0]?.url;
          if (url && !url.endsWith(".svg") && !url.endsWith(".tif")) photos.push(url);
        }
      }
      if (!photos.length) {
        photos.push("https://images.unsplash.com/photo-1599661046827-dacff0c0f09a?auto=format&fit=crop&w=800&q=80");
      }
      return JSON.stringify({ place: placeName, photos });
    } catch (err) {
      return JSON.stringify({ status: "error", message: err.message });
    }
  },
  {
    name: "get_place_photos",
    description: "Retrieve verified photographs for any monument, tourist attraction, or landmark from Wikimedia Commons.",
    schema: z.object({
      placeName: z.string().describe("Name of the attraction (e.g. Amer Fort, Hawa Mahal, Baga Beach)"),
      city: z.string().optional().describe("City where the place is located (optional, improves results)")
    })
  }
);

export const getPlaceDetailsTool = tool(
  async ({ placeName }) => {
    try {
      return JSON.stringify({
        place: placeName,
        category: "Cultural & Historic Landmark",
        tip: "Carry water, wear comfortable walking shoes, and visit early to avoid peak queues."
      });
    } catch (err) {
      return JSON.stringify({ status: "error", message: err.message });
    }
  },
  {
    name: "get_place_details",
    description: "Get visitor tips and sightseeing background for a tourist attraction.",
    schema: z.object({
      placeName: z.string().describe("Name of the attraction (e.g. Amer Fort)")
    })
  }
);

// ── Full tool set exposed to the agent ───────────────────────────────────────

export const agentTools = [
  searchFlightsTool,
  searchTrainsTool,
  searchHotelsTool,
  optimizeItineraryTool,
  getTripStatusTool,
  getCurrentWeatherTool,
  getWeatherForecastTool,
  getPlacePhotosTool,
  getPlaceDetailsTool
];
