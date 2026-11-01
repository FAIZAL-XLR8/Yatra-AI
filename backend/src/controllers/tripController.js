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

    let finalPriceInr = Math.round(Number(priceInr));
    let fareClass = req.body.fareClass || req.body.selectedClass || null;
    let fareBreakdown = [];
    let isLiveFare = false;

    // Phase 2: On train selection, hit live API for exact 100% IRCTC ticket price
    if (type.toUpperCase() === "TRAIN") {
      const trainNumber = req.body.trainNumber || (identifier.match(/^(\d+)/) ? identifier.match(/^(\d+)/)[1] : null);
      const matchedTrain = Array.isArray(trip.trainResults)
        ? trip.trainResults.find(t => t.id === trainNumber || t.identifier === identifier)
        : null;

      const originStation = req.body.fromStation || matchedTrain?.origin;
      const destStation = req.body.toStation || matchedTrain?.destination;

      if (trainNumber && originStation && destStation) {
        const { getLiveTrainFare } = await import("../services/trainService.js");
        const liveResult = await getLiveTrainFare({
          trainNo: trainNumber,
          fromStationCode: originStation,
          toStationCode: destStation,
          preferredClass: fareClass
        });

        if (liveResult.liveFare) {
          finalPriceInr = liveResult.liveFare;
          fareClass = liveResult.matchedClass;
          fareBreakdown = liveResult.fareBreakdown;
          isLiveFare = true;
        }
      }
    }

    trip.selectedTransport = {
      type: type.toUpperCase(),
      providerReference: providerReference || (type.toUpperCase() === "FLIGHT" ? "AMADEUS" : "IRCTC"),
      operatorName: operatorName || "",
      identifier,
      departureTime: departureTime || null,
      arrivalTime: arrivalTime || null,
      duration: duration || null,
      priceInr: finalPriceInr,
      fareClass: fareClass || null,
      isLiveFare,
      fareBreakdown,
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

    // Extract or find coordinates from hotel search results
    let lat = req.body.geoCode?.latitude || req.body.latitude || null;
    let lon = req.body.geoCode?.longitude || req.body.longitude || null;

    if ((!lat || !lon) && Array.isArray(trip.hotelResults)) {
      const matched = trip.hotelResults.find(
        (h) => h.hotelId === String(hotelId) || h.name?.toLowerCase() === String(name).toLowerCase()
      );
      if (matched?.geoCode?.latitude && matched?.geoCode?.longitude) {
        lat = matched.geoCode.latitude;
        lon = matched.geoCode.longitude;
      }
    }

    trip.selectedHotel = {
      hotelId: String(hotelId),
      name: String(name),
      location: location || null,
      starRating: starRating ? Number(starRating) : null,
      pricePerNightInr: pricePerNightInr ? Math.round(Number(pricePerNightInr)) : null,
      totalPriceInr: totalPriceInr ? Math.round(Number(totalPriceInr)) : null,
      nights: Number(nights) || 1,
      geoCode: lat && lon ? { latitude: Number(lat), longitude: Number(lon) } : null,
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

// @desc    Phase 5A: Review checkout invoice (transport + stay total)
// @route   GET /api/trips/:tripId/review
// @access  Private
export async function getTripReview(req, res) {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findOne({
      _id: tripId,
      userId: req.user._id
    });

    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    const { calculateTripInvoice } = await import("../services/paymentService.js");
    const invoice = calculateTripInvoice(trip);

    res.status(200).json({
      message: "Trip checkout review retrieved successfully.",
      tripId: trip._id,
      workflowStatus: trip.workflowStatus,
      paymentStatus: trip.paymentStatus,
      bookingStatus: trip.bookingStatus,
      invoice
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// @desc    Phase 5B: Create Razorpay payment order for trip
// @route   POST /api/trips/:tripId/payment/order
// @access  Private
export async function createTripPaymentOrder(req, res) {
  try {
    const { tripId } = req.params;

    const { createRazorpayOrder } = await import("../services/paymentService.js");
    const orderData = await createRazorpayOrder({
      tripId,
      userId: req.user._id
    });

    res.status(200).json({
      message: "Razorpay payment order created successfully.",
      ...orderData
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

// @desc    Phase 5C: Verify Razorpay cryptographic signature and confirm booking
// @route   POST /api/trips/:tripId/payment/verify
// @access  Private
export async function verifyTripPayment(req, res) {
  try {
    const { tripId } = req.params;
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({
        message: "razorpay_order_id and razorpay_payment_id are required."
      });
    }

    const { verifyRazorpayPayment } = await import("../services/paymentService.js");
    const confirmation = await verifyRazorpayPayment({
      tripId,
      userId: req.user._id,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature
    });

    // Phase 6: Auto-trigger background linking of confirmed hotel to Neo4j attraction graph
    const trip = await Trip.findById(tripId);
    if (trip?.selectedHotel?.name && trip?.tripSpec?.destination) {
      import("../services/hotelGraphService.js").then(({ linkHotelToAttractionGraph }) => {
        linkHotelToAttractionGraph({
          tripId: trip._id,
          destinationCity: trip.tripSpec.destination,
          hotelId: trip.selectedHotel.hotelId,
          hotelName: trip.selectedHotel.name,
          latitude: trip.selectedHotel.geoCode?.latitude,
          longitude: trip.selectedHotel.geoCode?.longitude
        }).catch((err) =>
          console.warn("[TripController] Background hotel graph link warning:", err.message)
        );
      });
    }

    res.status(200).json({
      message: "Payment verified successfully. Booking is now confirmed!",
      ...confirmation
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

// @desc    Phase 6: Link confirmed hotel to Neo4j destination attraction graph
// @route   POST /api/trips/:tripId/hotel-graph/link
// @access  Private
export async function linkTripHotelGraph(req, res) {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findOne({
      _id: tripId,
      userId: req.user._id
    });

    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    if (!trip.selectedHotel?.name) {
      return res.status(400).json({
        message: "No confirmed hotel selected on this trip yet."
      });
    }

    const { linkHotelToAttractionGraph } = await import("../services/hotelGraphService.js");
    const result = await linkHotelToAttractionGraph({
      tripId: trip._id,
      destinationCity: trip.tripSpec.destination,
      hotelId: trip.selectedHotel.hotelId,
      hotelName: trip.selectedHotel.name,
      latitude: trip.selectedHotel.geoCode?.latitude,
      longitude: trip.selectedHotel.geoCode?.longitude
    });

    res.status(200).json({
      message: "Hotel successfully linked to Neo4j attraction graph.",
      tripId: trip._id,
      workflowStatus: "HOTEL_GRAPH_LINKED",
      ...result
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// @desc    Phase 7: Optimize daily zero zig-zag itinerary with Neo4j and live OSRM road distances
// @route   POST /api/trips/:tripId/itinerary/optimize
// @access  Private
// Body (optional): { mode: "nearest"|"within"|"all", n: 6, km: 10 }
//   mode="nearest" → N closest attractions to hotel (Neo4j graph query)
//   mode="within"  → all attractions within km of hotel (Neo4j graph query)
//   mode="all"     → all city attractions, no hotel filter (default)
export async function optimizeTripItineraryController(req, res) {
  try {
    const { tripId } = req.params;
    const { mode = "all", n = 6, km = 10 } = req.body;

    const { optimizeTripItinerary } = await import("../services/optimizerService.js");
    const itinerary = await optimizeTripItinerary({
      tripId,
      userId: req.user._id,
      mode,
      n: Number(n),
      km: Number(km)
    });

    res.status(200).json({
      message: `Itinerary optimized (mode: ${mode}).`,
      tripId,
      workflowStatus: "ITINERARY_FINALIZED",
      itinerary
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// @desc    Retrieve saved finalized itinerary
// @route   GET /api/trips/:tripId/itinerary
// @access  Private
export async function getTripItinerary(req, res) {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findOne({
      _id: tripId,
      userId: req.user._id
    });

    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    if (!trip.itinerary) {
      return res.status(404).json({ message: "Itinerary has not been generated yet for this trip." });
    }

    res.status(200).json({
      tripId: trip._id,
      destination: trip.tripSpec.destination,
      workflowStatus: trip.workflowStatus,
      itinerary: trip.itinerary
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}


