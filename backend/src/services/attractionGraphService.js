import axios from "axios";

// ─── 1. Categorise a place based on its OSM type ─────────────────────────────
function categorise(osmType = "") {
  const t = osmType.toLowerCase();
  if (t.includes("fort") || t.includes("castle"))       return { category: "FORT",      estVisitHours: 2.5 };
  if (t.includes("museum"))                              return { category: "MUSEUM",    estVisitHours: 2.0 };
  if (t.includes("temple") || t.includes("church"))      return { category: "TEMPLE",    estVisitHours: 1.5 };
  if (t.includes("monument") || t.includes("memorial"))  return { category: "MONUMENT",  estVisitHours: 1.5 };
  if (t.includes("beach"))                               return { category: "BEACH",     estVisitHours: 2.5 };
  return { category: "ATTRACTION", estVisitHours: 2.0 };
}

// ─── 2. Fetch attractions for a city from OpenStreetMap Nominatim ─────────────
export async function discoverAttractions(city) {
  const { data } = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: { q: `attractions in ${city}`, format: "json", limit: 10 },
    headers: { "User-Agent": "YatraAI/1.0" },
    timeout: 8000
  });

  const seen = new Set();
  const citySlug = city.toLowerCase().replace(/\W/g, "_");

  return data
    .filter(item => {
      const name = item.display_name?.split(",")[0]?.trim();
      if (!name || name.length < 3 || seen.has(name)) return false;
      seen.add(name);
      return !isNaN(parseFloat(item.lat)) && !isNaN(parseFloat(item.lon));
    })
    .map((item, i) => {
      const name = item.display_name.split(",")[0].trim();
      const { category, estVisitHours } = categorise(item.type);
      return {
        id: `${citySlug}_${name.toLowerCase().replace(/\W/g, "_").slice(0, 20)}_${i}`,
        name,
        city,
        latitude:  parseFloat(item.lat),
        longitude: parseFloat(item.lon),
        category,
        estVisitHours
      };
    });
}

// ─── 3. Get road distance + duration between two points via free OSRM API ─────
export async function getRoadRoute(fromLat, fromLon, toLat, toLon) {
  const url = `http://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=false`;
  const { data } = await axios.get(url, { timeout: 6000 });
  const route = data?.routes?.[0];
  if (!route) throw new Error("OSRM returned no route");
  return {
    distanceKm:  parseFloat((route.distance / 1000).toFixed(2)),
    durationMins: Math.max(1, Math.round(route.duration / 60))
  };
}
