import express from "express";
import {
  createTripRequest,
  getTripById,
  searchTripTransport,
  selectTripTransport
} from "../controllers/tripController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", protect, createTripRequest);
router.get("/:tripId", protect, getTripById);

// Phase 1: Concurrent Transport Search Fan-Out / Fan-In
router.post("/:tripId/transport/search", protect, searchTripTransport);

// Phase 2: HITL Transport Selection Gate
router.post("/:tripId/transport/select", protect, selectTripTransport);

export default router;
