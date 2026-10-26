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
      const arrivalTime = train.to_std
        ? `${departureDate}T${train.to_std}:00`
        : null;

      const availableClasses = Array.isArray(train.class_type) ? train.class_type : [];
      const duration = train.duration ? String(train.duration) : null;
      const priceInr = Number(train.fare) > 0 ? Math.round(Number(train.fare)) : null;

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
        duration,
        availableClasses,
        priceInr
      });
    }

    return normalizedTrains;
  } catch (error) {
    console.error(
      `[TrainService] Train search failed for ${originStation}->${destStation} on ${departureDate}:`,
      error.response?.data?.message || error.message
    );
    return [];
  }
}
