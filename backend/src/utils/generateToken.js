import jwt from "jsonwebtoken";
import { config } from "../config/env.js";

/**
 * Generates a signed JWT and attaches it to an HTTP-only cookie on the response.
 * @param {import('express').Response} res - Express response object
 * @param {string} userId - MongoDB User _id string
 * @returns {string} The signed JWT
 */
export function generateTokenAndSetCookie(res, userId) {
  const token = jwt.sign({ id: userId }, config.jwtSecret, {
    expiresIn: "30d"
  });

  res.cookie("jwt", token, {
    httpOnly: true, // Prevents client-side JS from reading the cookie (anti-XSS)
    secure: config.nodeEnv === "production", // HTTPS only in production
    sameSite: "strict", // Protects against CSRF attacks
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds
  });

  return token;
}
