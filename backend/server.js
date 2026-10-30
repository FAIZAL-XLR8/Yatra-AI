import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./src/config/env.js";
import { connectDB } from "./src/config/db.js";
import authRoutes from "./src/routes/authRoutes.js";
import tripRoutes from "./src/routes/tripRoutes.js";

const app = express();

// Core Middleware
app.use(cors({
  origin: config.clientOrigin,
  credentials: true // Allows cookies to travel between frontend & backend
}));
app.use(express.json()); // Parses incoming JSON in req.body
app.use(cookieParser()); // Parses incoming cookies in req.cookies

// Mount API Routes
app.use("/api/auth", authRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/trip", tripRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Connect to Database
connectDB();

app.listen(config.port, () => {
  console.log(`[Server] Running in ${config.nodeEnv} mode on port ${config.port}`);
});
