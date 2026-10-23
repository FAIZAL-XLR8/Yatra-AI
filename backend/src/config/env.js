import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || "development",
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET || "dev_jwt_secret_key_123",
  mongodbUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/yatra_ai"
};
