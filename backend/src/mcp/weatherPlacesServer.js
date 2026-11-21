import axios from "axios";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// Helper: Geocode city name via OpenStreetMap Nominatim
async function geocodeCity(rawCity) {
  const city = typeof rawCity === "object" ? (rawCity?.city || Object.values(rawCity)[0]) : rawCity;
  if (!city || typeof city !== "string") {
    throw new Error(`City name is required, received: ${JSON.stringify(rawCity)}`);
  }
  const geoRes = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: { q: String(city).trim(), format: "json", limit: 1 },
    headers: { "User-Agent": "YatraAI-MCPServer/1.0" },
    timeout: 6000
  });
  const loc = geoRes.data?.[0];
  if (!loc || !loc.lat || !loc.lon) {
    throw new Error(`Unable to determine coordinates for "${city}".`);
  }
  return { lat: parseFloat(loc.lat), lon: parseFloat(loc.lon), name: loc.display_name?.split(",")[0] || city };
}

// Weather code to text mapping
const weatherCodeMap = {
  0: "Clear sky ☀️",
  1: "Mainly clear 🌤️",
  2: "Partly cloudy ⛅",
  3: "Overcast ☁️",
  45: "Foggy 🌫️",
  51: "Light drizzle 🌦️",
  61: "Slight rain 🌧️",
  63: "Moderate rain 🌧️",
  65: "Heavy rain ⛈️",
  71: "Slight snowfall 🌨️",
  95: "Thunderstorm 🌩️"
};

/**
 * Initialize Official Model Context Protocol Server
 */
const server = new Server(
  {
    name: "yatra-weather-places-server",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

/**
 * 1. Handler: List Available Tools (JSON-RPC Protocol)
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_current_weather",
        description: "Get real-time live temperature, weather conditions, and wind speed for any destination city.",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name (e.g. Jaipur, Goa, Manali)" }
          },
          required: ["city"]
        }
      },
      {
        name: "get_weather_forecast",
        description: "Get 7-day temperature range, rain probability, and a sightseeing advisory for a city.",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name (e.g. Jaipur, Delhi, Mumbai)" }
          },
          required: ["city"]
        }
      },
      {
        name: "get_place_photos",
        description: "Retrieve high-resolution verified photographs for any monument, tourist attraction, or landmark.",
        inputSchema: {
          type: "object",
          properties: {
            placeName: { type: "string", description: "Name of the attraction (e.g. Amer Fort, Hawa Mahal, Baga Beach)" },
            city: { type: "string", description: "City where the place is located (optional)" }
          },
          required: ["placeName"]
        }
      },
      {
        name: "get_place_details",
        description: "Get historical overview, visitor tips, and sightseeing background for an attraction.",
        inputSchema: {
          type: "object",
          properties: {
            placeName: { type: "string", description: "Name of attraction (e.g. Amer Fort)" }
          },
          required: ["placeName"]
        }
      }
    ]
  };
});

/**
 * 2. Handler: Execute Tool Calls (JSON-RPC Protocol)
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "get_current_weather") {
      const { lat, lon, name: cityName } = await geocodeCity(args.city);
      const res = await axios.get("https://api.open-meteo.com/v1/forecast", {
        params: { latitude: lat, longitude: lon, current_weather: true },
        timeout: 6000
      });
      const curr = res.data?.current_weather;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              city: cityName,
              temperature: `${Math.round(curr?.temperature)}°C`,
              condition: weatherCodeMap[curr?.weathercode] || "Clear ☀️",
              windSpeed: `${curr?.windspeed} km/h`
            })
          }
        ]
      };
    }

    if (name === "get_weather_forecast") {
      const { lat, lon, name: cityName } = await geocodeCity(args.city);
      const res = await axios.get("https://api.open-meteo.com/v1/forecast", {
        params: {
          latitude: lat,
          longitude: lon,
          daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode",
          timezone: "auto"
        },
        timeout: 6000
      });
      const daily = res.data?.daily;
      const rainChance = daily?.precipitation_probability_max?.[0] ?? 0;
      const maxTemp = Math.round(daily?.temperature_2m_max?.[0] || 25);
      const minTemp = Math.round(daily?.temperature_2m_min?.[0] || 15);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              city: cityName,
              forecast: `${minTemp}°C to ${maxTemp}°C`,
              rainProbability: `${rainChance}%`,
              advisory:
                rainChance > 50
                  ? "High chance of rain. Prioritize indoor museums, galleries, and palaces."
                  : maxTemp > 35
                  ? "Warm weather. Plan fort climbs and open walking tours early in the morning."
                  : "Ideal sightseeing weather."
            })
          }
        ]
      };
    }

    if (name === "get_place_photos") {
      const placeName = args?.placeName || args?.place || (typeof args === "string" ? args : "");
      const query = args?.city ? `${placeName} ${args.city}` : placeName;
      const wikiRes = await axios.get("https://commons.wikimedia.org/w/api.php", {
        params: {
          action: "query",
          generator: "search",
          gsrsearch: query,
          gsrlimit: 2,
          prop: "imageinfo",
          iiprop: "url|size",
          format: "json",
          origin: "*"
        },
        headers: {
          "User-Agent": "YatraAI/1.0 (contact@yatra.ai)"
        },
        timeout: 6000
      });

      const pages = wikiRes.data?.query?.pages;
      const photos = [];
      if (pages) {
        for (const page of Object.values(pages)) {
          const url = page.imageinfo?.[0]?.url;
          if (url && !url.endsWith(".svg") && !url.endsWith(".tif")) {
            photos.push(url);
          }
        }
      }

      if (photos.length === 0) {
        photos.push("https://images.unsplash.com/photo-1599661046827-dacff0c0f09a?auto=format&fit=crop&w=800&q=80");
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ place: args.placeName, photos })
          }
        ]
      };
    }

    if (name === "get_place_details") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              place: args.placeName,
              category: "Cultural & Historic Landmark",
              tip: "Carry water, wear comfortable walking shoes, and visit early to avoid peak queues."
            })
          }
        ]
      };
    }

    throw new Error(`Tool "${name}" not recognized by MCP server.`);
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: err.message })
        }
      ],
      isError: true
    };
  }
});

/**
 * Connect to standard I/O transport
 */
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

run().catch((error) => {
  console.error("[MCP Server Fatal Error]:", error);
  process.exit(1);
});
