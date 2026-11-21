import { StateGraph, END, START } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatGroq } from "@langchain/groq";
import { SystemMessage } from "@langchain/core/messages";
import { config } from "../config/env.js";
import { TripAgentState } from "./state.js";
import { agentTools } from "./tools.js";

const SYSTEM_PROMPT = `You are Yatra AI — an expert AI travel planner powered by live travel APIs.

Key Responsibilities:
1. Help users plan real-world journeys across India with zero hallucinated prices or schedules.
2. When a user requests a journey (e.g., "Plan a 3-day trip from Delhi to Jaipur on Dec 5 for 2 people"):
   - Extract: origin, destination, departure date (YYYY-MM-DD), passenger count, and budget tier.
3. Actively use your available tools:
   - Live Transport: 'search_flights' and 'search_trains'.
   - Stays: 'search_hotels' to discover verified accommodation.
   - Climate: 'get_current_weather' and 'get_weather_forecast' for live temperatures and sightseeing advisories.
   - Spatial Optimization: 'optimize_itinerary' for zero-backtracking, day-by-day plans.
   - Visuals & Tips: 'get_place_photos' and 'get_place_details' for real photos and visitor tips.
4. CRITICAL RULES:
   - NEVER invent flight numbers, train numbers, or prices. Always call the tools.
   - If travel dates are relative (e.g. "next Friday"), compute the approximate YYYY-MM-DD date.
   - Always present prices in INR (₹).
   - Share the weather advisory (e.g., "Sunny, 24°C — great for outdoor forts").
   - Remind the user that bookings are confirmed securely via Razorpay.`;

function buildModel() {
  const apiKey = config.groqApiKey;
  if (!apiKey) {
    console.warn("[AgentGraph] GROQ_API_KEY is not set in .env. Agent requests will fail.");
  }
  return new ChatGroq({
    apiKey: apiKey || "dummy_key",
    model: "llama-3.3-70b-versatile",
    temperature: 0.2
  });
}

let compiledApp = null;

/**
 * Returns the compiled LangGraph ReAct agent (singleton).
 * No MCP subprocess — all tools run in-process.
 */
export async function getTravelAgentApp() {
  if (compiledApp) return compiledApp;

  const toolNode = new ToolNode(agentTools);

  async function callModelNode(state) {
    const model = buildModel().bindTools(agentTools);
    const messages = state.messages || [];
    const response = await model.invoke([new SystemMessage(SYSTEM_PROMPT), ...messages]);
    return { messages: [response] };
  }

  function shouldContinue(state) {
    const last = state.messages[state.messages.length - 1];
    return last?.tool_calls?.length > 0 ? "tools" : END;
  }

  const workflow = new StateGraph(TripAgentState)
    .addNode("agent", callModelNode)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      [END]: END
    })
    .addEdge("tools", "agent");

  compiledApp = workflow.compile();
  return compiledApp;
}
