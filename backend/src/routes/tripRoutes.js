import express from "express";
import {
  createTripRequest,
  getTripById,
  searchTripTransport,
  selectTripTransport,
  searchTripHotels,
  selectTripHotel,
  getTripReview,
  createTripPaymentOrder,
  verifyTripPayment,
  linkTripHotelGraph,
  optimizeTripItineraryController,
  getTripItinerary
} from "../controllers/tripController.js";
import { protect } from "../middleware/authMiddleware.js";

import { buildItinerary } from "../services/itineraryService.js";

const router = express.Router();

// GET /api/trip/itinerary?city=Jaipur
router.get("/itinerary", async (req, res) => {
  try {
    const { city } = req.query;
    if (!city) {
      return res.status(400).json({ message: "City query parameter is required" });
    }
    const days = await buildItinerary(city);
    return res.json({ city, days });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
});

router.post("/", protect, createTripRequest);
router.get("/:tripId", protect, getTripById);

// Phase 1: Concurrent Transport Search Fan-Out / Fan-In
router.post("/:tripId/transport/search", protect, searchTripTransport);

// Phase 2: HITL Transport Selection Gate
router.post("/:tripId/transport/select", protect, selectTripTransport);

// Phase 3A: Hotel Discovery (City-wide or Landmark Radius)
router.post("/:tripId/hotels/search", protect, searchTripHotels);

// Phase 4: HITL Hotel Selection Gate
router.post("/:tripId/hotels/select", protect, selectTripHotel);

// Phase 5: Review Checkout & Razorpay Payment Nodes
router.get("/:tripId/review", protect, getTripReview);
router.post("/:tripId/payment/order", protect, createTripPaymentOrder);
router.post("/:tripId/payment/verify", protect, verifyTripPayment);

// Phase 6: Confirmed Hotel-to-Attractions Neo4j Edge Node
router.post("/:tripId/hotel-graph/link", protect, linkTripHotelGraph);

// Phase 7: Parameterized Cypher Itinerary Optimizer Node
router.post("/:tripId/itinerary/optimize", protect, optimizeTripItineraryController);
router.get("/:tripId/itinerary", protect, getTripItinerary);

export default router;
