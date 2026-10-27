import express from "express";
import {
  createTripRequest,
  getTripById,
  searchTripTransport,
  selectTripTransport,
  searchTripHotels,
  selectTripHotel
} from "../controllers/tripController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

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

export default router;
