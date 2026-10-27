import neo4j from "neo4j-driver";
import { config } from "./env.js";

let driver = null;
let isConnected = false;

/**
 * Initializes and returns the singleton Neo4j driver.
 */
export function getNeo4jDriver() {
  if (!driver) {
    const { neo4jUri, neo4jUser, neo4jPassword } = config;

    // If password is not provided, do not initialize
    if (!neo4jPassword) {
      console.warn(
        "[Neo4j] NEO4J_PASSWORD is not set in .env. Knowledge graph operations will be bypassed."
      );
      return null;
    }

    try {
      driver = neo4j.driver(neo4jUri, neo4j.auth.basic(neo4jUser, neo4jPassword), {
        maxConnectionPoolSize: 50,
        connectionTimeout: 10000
      });
    } catch (error) {
      console.error("[Neo4j] Failed to initialize driver:", error.message);
      driver = null;
    }
  }

  return driver;
}

/**
 * Verifies connectivity to the Neo4j database.
 * Returns true if connected, false otherwise.
 */
export async function verifyNeo4jConnection() {
  const currentDriver = getNeo4jDriver();
  if (!currentDriver) {
    isConnected = false;
    return false;
  }

  let session = null;
  try {
    session = currentDriver.session();
    const result = await session.run("RETURN 1 AS alive");
    isConnected = result.records[0].get("alive").toNumber() === 1;
    if (isConnected) {
      console.log(`[Neo4j] Connected successfully to ${config.neo4jUri}`);
    }
    return isConnected;
  } catch (error) {
    console.warn(
      `[Neo4j] Could not connect to Neo4j instance at ${config.neo4jUri}: ${error.message}`
    );
    isConnected = false;
    return false;
  } finally {
    if (session) {
      await session.close();
    }
  }
}

/**
 * Obtains a new Neo4j session. Caller is responsible for closing the session.
 */
export function getNeo4jSession(database = undefined) {
  const currentDriver = getNeo4jDriver();
  if (!currentDriver) return null;
  return currentDriver.session(database ? { database } : undefined);
}

/**
 * Gracefully closes the driver.
 */
export async function closeNeo4jDriver() {
  if (driver) {
    await driver.close();
    driver = null;
    isConnected = false;
    console.log("[Neo4j] Driver connection closed.");
  }
}
