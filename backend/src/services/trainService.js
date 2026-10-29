import axios from "axios";
import { config } from "../config/env.js";

/**
 * Common Indian city to primary railway station code mapping.
 */
const CITY_TO_STATION = {
  delhi: "NDLS",
  "new delhi": "NDLS",
  mumbai: "CSMT",
  bombay: "CSMT",
  bangalore: "SBC",
  bengaluru: "SBC",
  kolkata: "HWH",
  calcutta: "HWH",
  chennai: "MAS",
  madras: "MAS",
  hyderabad: "SC",
  secunderabad: "SC",
  pune: "PUNE",
  ahmedabad: "ADI",
  jaipur: "JP",
  goa: "MAO",
  madgaon: "MAO",
  varanasi: "BSB",
  agra: "AGC",
  lucknow: "LKO",
  chandigarh: "CDG",
  amritsar: "ASR",
  patna: "PNBE",
  bhopal: "BPL",
  indore: "INDB",
  surat: "ST",
  dehradun: "DDN",
  haridwar: "HW",
  rishikesh: "YNRK",
  shimla: "SML",
  jammu: "JAT",
  guwahati: "GHY",
  bhubaneswar: "BBS",
  puri: "PURI",
  kochi: "ERS",
  cochin: "ERS",
  ernakulam: "ERS",
  thiruvananthapuram: "TVC",
  trivandrum: "TVC",
  coimbatore: "CBE",
  madurai: "MDU",
  visakhapatnam: "VSKP",
  vizag: "VSKP",
  udaipur: "UDZ",
  jodhpur: "JU",
  jaisalmer: "JSM",
  ranchi: "RNC",
  raipur: "R",
  gwalior: "GWL",
  jabalpur: "JBP",
  mathura: "MTJ",
  ayodhya: "AY"
};

/**
 * Normalizes input string to resolve IRCTC railway station code.
 *
 * @param {string} cityOrCode - City name or station code (e.g. "Delhi", "NDLS").
 * @returns {string|null} 2-5 letter uppercase station code or null.
 */
export function resolveStationCode(cityOrCode) {
  if (!cityOrCode || typeof cityOrCode !== "string") return null;

  const rawTrimmed = cityOrCode.trim();

  // If already a valid station code (2-5 uppercase letters)
  if (/^[A-Za-z]{2,5}$/.test(rawTrimmed) && Object.values(CITY_TO_STATION).includes(rawTrimmed.toUpperCase())) {
    return rawTrimmed.toUpperCase();
  }

  const normalized = rawTrimmed
    .toLowerCase()
    .replace(/,\s*india$/i, "")
    .replace(/[^\w\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (CITY_TO_STATION[normalized]) {
    return CITY_TO_STATION[normalized];
  }

  // Check prefix or partial match (e.g. "jaipur city" -> "jaipur")
  for (const [city, code] of Object.entries(CITY_TO_STATION)) {
    if (normalized.startsWith(`${city} `) || normalized.endsWith(` ${city}`)) {
      return code;
    }
  }

  return null;
}

const trainCache = new Map();

/**
 * Searches live Indian Railways trains between origin and destination stations.
 * Normalizes up to 10 trains into the standardized Yatra AI schema.
 *
 * @param {Object} params
 * @param {string} params.origin - Origin city or station code.
 * @param {string} params.destination - Destination city or station code.
 * @param {string} params.departureDate - YYYY-MM-DD.
 * @param {number} [params.passengers=1] - Passenger count.
 * @returns {Promise<Array>} Normalized array of up to 10 trains.
 */
export async function searchTrains({ origin, destination, departureDate, passengers = 1 }) {
  const originStation = resolveStationCode(origin);
  const destStation = resolveStationCode(destination);

  if (!originStation || !destStation) {
    console.log(
      `[TrainService] Skipping train search: Unable to resolve station code for origin="${origin}" (${originStation || "none"}) or destination="${destination}" (${destStation || "none"}).`
    );
    return [];
  }

  if (originStation === destStation) {
    console.log(`[TrainService] Origin and destination resolve to the same station (${originStation}). Returning empty trains.`);
    return [];
  }

  const cacheKey = `${originStation}_${destStation}_${departureDate}`;
  if (trainCache.has(cacheKey)) {
    return trainCache.get(cacheKey);
  }

  const { rapidApiKey } = config;

  if (!rapidApiKey) {
    console.warn(
      "[TrainService] RAPIDAPI_KEY is missing in .env. Live train search will return empty."
    );
    return [];
  }

  try {
    const url = "https://irctc1.p.rapidapi.com/api/v3/trainBetweenStations";
    const response = await axios.get(url, {
      headers: {
        "x-rapidapi-key": rapidApiKey,
        "x-rapidapi-host": "irctc1.p.rapidapi.com"
      },
      params: {
        fromStationCode: originStation,
        toStationCode: destStation,
        dateOfJourney: departureDate
      },
      timeout: 10000
    });

    const rawTrains = response.data?.data || [];
    if (!Array.isArray(rawTrains)) return [];

    const normalizedTrains = [];

    for (const train of rawTrains) {
      if (normalizedTrains.length >= 10) break;

      const trainNumber = train.train_number ? String(train.train_number).trim() : null;
      const trainName = train.train_name ? String(train.train_name).trim() : null;

      // Discard malformed records missing primary identifiers
      if (!trainNumber || !trainName) continue;

      const departureTime = train.from_std
        ? `${departureDate}T${train.from_std}:00`
        : null;

      // Handle next-day or multi-day journey arrival accurately
      let arrivalDateStr = departureDate;
      const dayOffset = Number(train.to_day) || 0;
      if (dayOffset > 0 && departureDate) {
        const depDateObj = new Date(departureDate);
        depDateObj.setDate(depDateObj.getDate() + dayOffset);
        arrivalDateStr = depDateObj.toISOString().split("T")[0];
      }
      const arrivalTime = train.to_std
        ? `${arrivalDateStr}T${train.to_std}:00`
        : null;

      const availableClasses = Array.isArray(train.class_type) ? train.class_type : [];

      // Format allocated travel duration (e.g. "15:40" -> "15h 40m")
      let formattedDuration = train.duration ? String(train.duration) : null;
      if (formattedDuration && formattedDuration.includes(":")) {
        const [h, m] = formattedDuration.split(":");
        formattedDuration = `${parseInt(h, 10)}h ${parseInt(m, 10)}m`;
      }

      // Calculate price range for search display (e.g. SL/CC to 2A/1A)
      let priceMin = null;
      let priceMax = null;
      let priceInr = Number(train.fare) > 0 ? Math.round(Number(train.fare)) : null;

      if (train.distance) {
        const dist = Number(train.distance);
        const type = String(train.train_type || "").toUpperCase();
        const isPremium = ["RAJ", "VB", "SHATABDI", "TEJAS", "DRNT"].includes(type);

        if (isPremium) {
          // Premium trains (Rajdhani, Vande Bharat, Tejas): 3AC/CC up to 1AC/EC
          priceMin = Math.round(750 + dist * 1.1);
          priceMax = Math.round(1400 + dist * 2.2);
        } else {
          // Standard Superfast / Express: Sleeper (min) to 2AC/1AC (max)
          priceMin = Math.round(150 + dist * 0.45);
          priceMax = Math.round(650 + dist * 1.35);
        }
        if (!priceInr) {
          priceInr = priceMin;
        }
      }

      normalizedTrains.push({
        id: trainNumber,
        type: "TRAIN",
        providerReference: "IRCTC",
        operatorName: "INDIAN_RAILWAYS",
        identifier: `${trainNumber}-${trainName.replace(/\s+/g, "_").toUpperCase()}`,
        trainName,
        trainNumber,
        origin: originStation,
        destination: destStation,
        departureTime,
        arrivalTime,
        duration: formattedDuration,
        availableClasses,
        priceRange: priceMin && priceMax ? { min: priceMin, max: priceMax } : null,
        priceInr
      });
    }

    if (normalizedTrains.length > 0) {
      trainCache.set(cacheKey, normalizedTrains);
    }

    return normalizedTrains;
  } catch (error) {
    if (error.response?.status === 429) {
      console.warn(
        `[TrainService] RapidAPI IRCTC monthly quota reached (429). Monthly limit on Basic free tier is 10 requests. Check https://rapidapi.com/developer/dashboard.`
      );
    } else {
      console.error(
        `[TrainService] Train search failed for ${originStation}->${destStation} on ${departureDate}:`,
        error.response?.data?.message || error.message
      );
    }
    return [];
  }
}

/**
 * Fetches the 100% exact live IRCTC ticket fare for a specific train upon selection.
 * Hits https://irctc1.p.rapidapi.com/api/v1/getFare directly.
 *
 * @param {Object} params
 * @param {string} params.trainNo - Train number (e.g. "12952").
 * @param {string} params.fromStationCode - Station code (e.g. "NDLS").
 * @param {string} params.toStationCode - Station code (e.g. "MMCT").
 * @param {string} [params.preferredClass] - Preferred class (e.g. "3A", "CC", "2A", "SL").
 * @returns {Promise<Object>} { liveFare: number|null, fareBreakdown: Array, matchedClass: string|null, isLiveFare: boolean }
 */
export async function getLiveTrainFare({ trainNo, fromStationCode, toStationCode, preferredClass }) {
  const { rapidApiKey } = config;
  if (!rapidApiKey || !trainNo || !fromStationCode || !toStationCode) {
    return { liveFare: null, fareBreakdown: [], matchedClass: null, isLiveFare: false };
  }

  const cleanTrainNo = String(trainNo).replace(/\D/g, "");
  const originCode = resolveStationCode(fromStationCode) || String(fromStationCode).toUpperCase();
  const destCode = resolveStationCode(toStationCode) || String(toStationCode).toUpperCase();

  try {
    const url = "https://irctc1.p.rapidapi.com/api/v1/getFare";
    const response = await axios.get(url, {
      headers: {
        "x-rapidapi-key": rapidApiKey,
        "x-rapidapi-host": "irctc1.p.rapidapi.com"
      },
      params: {
        trainNo: cleanTrainNo,
        fromStationCode: originCode,
        toStationCode: destCode
      },
      timeout: 8000
    });

    const fares = response.data?.data || [];
    if (!Array.isArray(fares) || fares.length === 0) {
      return { liveFare: null, fareBreakdown: [], matchedClass: null, isLiveFare: false };
    }

    // Match preferred class, or 3A / CC, or first available fare
    let matched = null;
    if (preferredClass) {
      matched = fares.find(f => String(f.class_type).toUpperCase() === String(preferredClass).toUpperCase());
    }
    if (!matched) {
      matched = fares.find(f => ["3A", "CC", "2A", "SL"].includes(String(f.class_type).toUpperCase())) || fares[0];
    }

    const liveFare = matched && Number(matched.fare) > 0 ? Math.round(Number(matched.fare)) : null;

    return {
      liveFare,
      fareBreakdown: fares,
      matchedClass: matched?.class_type || null,
      isLiveFare: liveFare !== null
    };
  } catch (error) {
    if (error.response?.status === 429) {
      console.warn("[TrainService] RapidAPI monthly quota reached when fetching live fare. Falling back to estimated price.");
    } else {
      console.error("[TrainService] Live fare check failed:", error.response?.data?.message || error.message);
    }
    return { liveFare: null, fareBreakdown: [], matchedClass: null, isLiveFare: false };
  }
}
