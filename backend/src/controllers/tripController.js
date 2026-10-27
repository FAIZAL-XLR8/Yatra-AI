import Trip from "../models/Trip.js";

// @desc    Validate trip request & initialize trip session
// @route   POST /api/trips
// @access  Private (requires protect middleware)
export async function createTripRequest(req, res) {
  try {
    const {
      origin,
      destination,
      departureDate,
      returnDate,
      passengers = 1,
      budgetInr,
      preferences = {}
    } = req.body;

    // 1. Validate required fields
    if (!origin || !destination || !departureDate) {
      return res.status(400).json({
        message: "Origin, destination, and departureDate are required."
      });
    }

    if (origin.trim().toLowerCase() === destination.trim().toLowerCase()) {
      return res.status(400).json({
        message: "Origin and destination cannot be the same city."
      });
    }

    if (passengers < 1) {
      return res.status(400).json({
        message: "Passenger count must be at least 1."
      });
    }

    // 2. Persist initial trip state in MongoDB
    const trip = await Trip.create({
      userId: req.user._id,
      tripSpec: {
        origin: origin.trim(),
        destination: destination.trim(),
        departureDate,
        returnDate: returnDate || null,
        passengers: Number(passengers),
        budgetInr: budgetInr ? Number(budgetInr) : null,
        preferences: {
          budgetTier: preferences.budgetTier || "mid-range",
          travelStyle: preferences.travelStyle || "solo",
          dietary: preferences.dietary || "Any"
        }
      },
      workflowStatus: "INPUT_VALIDATED"
    });

    // 3. Return validated trip session to frontend
    res.status(201).json({
      message: "Trip input validated successfully.",
      tripId: trip._id,
      workflowStatus: trip.workflowStatus,
      tripSpec: trip.tripSpec
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// @desc    Get current trip state by tripId
// @route   GET /api/trips/:tripId
// @access  Private
export async function getTripById(req, res) {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findOne({
      _id: tripId,
      userId: req.user._id
    });

    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    res.status(200).json(trip);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// @desc    Phase 1: Search live transport options (flights & trains in parallel)
// @route   POST /api/trips/:tripId/transport/search
// @access  Private
export async function searchTripTransport(req, res) {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findOne({
      _id: tripId,
      userId: req.user._id
    });

    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    const { origin, destination, departureDate, passengers } = trip.tripSpec;

    // Concurrent Fan-Out / Fan-In
    const { searchTransport } = await import("../services/transportService.js");
    const { flightResults, trainResults } = await searchTransport({
      origin,
      destination,
      departureDate,
      passengers
    });

    trip.flightResults = flightResults;
    trip.trainResults = trainResults;
    trip.workflowStatus = "TRANSPORT_SEARCHED";

    await trip.save();

    res.status(200).json({
      message: "Transport search completed.",
      tripId: trip._id,
      workflowStatus: trip.workflowStatus,
      flightResults: trip.flightResults,
      trainResults: trip.trainResults
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// @desc    Phase 2: Human-in-the-loop transport selection gate
// @route   POST /api/trips/:tripId/transport/select
// @access  Private
export async function selectTripTransport(req, res) {
  try {
    const { tripId } = req.params;
    const {
      type,
      providerReference,
      operatorName,
      identifier,
      departureTime,
      arrivalTime,
      duration,
      priceInr
    } = req.body;

    if (!type || !["FLIGHT", "TRAIN"].includes(type.toUpperCase())) {
      return res.status(400).json({ message: "Valid transport type ('FLIGHT' or 'TRAIN') is required." });
    }

    if (!identifier || priceInr === undefined || priceInr === null) {
      return res.status(400).json({ message: "Identifier and priceInr are required." });
    }

    const trip = await Trip.findOne({
      _id: tripId,
      userId: req.user._id
    });

    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    trip.selectedTransport = {
      type: type.toUpperCase(),
      providerReference: providerReference || (type.toUpperCase() === "FLIGHT" ? "AMADEUS" : "IRCTC"),
      operatorName: operatorName || "",
      identifier,
      departureTime: departureTime || null,
      arrivalTime: arrivalTime || null,
      duration: duration || null,
      priceInr: Math.round(Number(priceInr)),
      selectedAt: new Date()
    };

    trip.workflowStatus = "TRANSPORT_SELECTED";
    await trip.save();

    res.status(200).json({
      message: "Transport selection saved successfully.",
      tripId: trip._id,
      workflowStatus: trip.workflowStatus,
      selectedTransport: trip.selectedTransport
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// @desc    Phase 3A: Search hotels across destination city or landmark radius
// @route   POST /api/trips/:tripId/hotels/search
// @access  Private
export async function searchTripHotels(req, res) {
  try {
    const { tripId } = req.params;
    const { landmark, radiusKm = 6 } = req.body || {};

    const trip = await Trip.findOne({
      _id: tripId,
      userId: req.user._id
    });

    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    const { destination } = trip.tripSpec;
    const { searchHotels } = await import("../services/hotelService.js");

    const hotelResults = await searchHotels({
      destination,
      landmark: landmark || null,
      radiusKm: Number(radiusKm) || 6,
      max: 20
    });

    trip.hotelResults = hotelResults;
    if (landmark) {
      trip.landmarkSearch = {
        landmark: String(landmark).trim(),
        radiusKm: Number(radiusKm) || 6
      };
    }
    trip.workflowStatus = "HOTELS_SEARCHED";

    await trip.save();

    // Trigger Node 3B in background: build reusable Neo4j knowledge graph without blocking user response
    import("../services/attractionGraphService.js").then(({ buildAttractionKnowledgeGraph }) => {
      buildAttractionKnowledgeGraph(destination).catch((err) =>
        console.warn("[TripController] Background attraction graph build warning:", err.message)
      );
    });

    res.status(200).json({
      message: "Hotel discovery completed.",
      tripId: trip._id,
      workflowStatus: trip.workflowStatus,
      hotelResults: trip.hotelResults,
      landmarkSearch: trip.landmarkSearch
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// @desc    Phase 4: Human-in-the-loop hotel selection gate
// @route   POST /api/trips/:tripId/hotels/select
// @access  Private
export async function selectTripHotel(req, res) {
  try {
    const { tripId } = req.params;
    const {
      hotelId,
      name,
      location,
      starRating,
      pricePerNightInr,
      totalPriceInr,
      nights = 1
    } = req.body;

    if (!hotelId || !name) {
      return res.status(400).json({ message: "hotelId and name are required." });
    }

    const trip = await Trip.findOne({
      _id: tripId,
      userId: req.user._id
    });

    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    trip.selectedHotel = {
      hotelId: String(hotelId),
      name: String(name),
      location: location || null,
      starRating: starRating ? Number(starRating) : null,
      pricePerNightInr: pricePerNightInr ? Math.round(Number(pricePerNightInr)) : null,
      totalPriceInr: totalPriceInr ? Math.round(Number(totalPriceInr)) : null,
      nights: Number(nights) || 1,
      selectedAt: new Date()
    };

    trip.workflowStatus = "HOTEL_SELECTED";
    await trip.save();

    res.status(200).json({
      message: "Hotel selection saved successfully.",
      tripId: trip._id,
      workflowStatus: trip.workflowStatus,
      selectedHotel: trip.selectedHotel
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

