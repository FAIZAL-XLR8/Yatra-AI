import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { config } from "../config/env.js";

/**
 * Middleware that validates the HTTP-only JWT cookie and attaches the user object to req.user.
 */
export async function protect(req, res, next) {
  try {
    const token = req.cookies.jwt;

    if (!token) {
      return res.status(401).json({ message: "Not authorized, no token provided" });
    }

    // Verify token with secret
    const decoded = jwt.verify(token, config.jwtSecret);

    // Fetch user from DB and exclude password
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({ message: "Not authorized, user not found" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Not authorized, invalid or expired token" });
  }
}

