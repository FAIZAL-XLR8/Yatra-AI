import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || "development",
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET || "dev_jwt_secret_key_123",
  mongodbUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/yatra_ai",
  amadeusClientId: process.env.AMADEUS_CLIENT_ID || "",
  amadeusClientSecret: process.env.AMADEUS_CLIENT_SECRET || "",
  rapidApiKey: process.env.RAPID_API_KEY || process.env.RAPIDAPI_KEY || "",
  neo4jUri: process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4jUser: process.env.NEO4J_USER || "neo4j",
  neo4jPassword: process.env.NEO4J_PASSWORD || "",
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
  groqApiKey: process.env.GROQ_API_KEY || ""
};
