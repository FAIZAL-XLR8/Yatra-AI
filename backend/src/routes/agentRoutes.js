import express from "express";
import { chatWithAgent, getAgentStatus } from "../controllers/agentController.js";

const router = express.Router();

// GET /api/agent/status
router.get("/status", getAgentStatus);

// POST /api/agent/chat
router.post("/chat", chatWithAgent);

export default router;
