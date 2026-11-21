import { StateGraph, END, START } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatGroq } from "@langchain/groq";
import { SystemMessage } from "@langchain/core/messages";
import { config } from "../config/env.js";
import { TripAgentState } from "./state.js";
import { getCompleteAgentTools, nativeAgentTools } from "./tools.js";

const SYSTEM_PROMPT = `You are Yatra AI — an expert AI travel planner powered by live travel APIs and the Model Context Protocol (MCP).

Key Responsibilities:
1. Help users plan real-world journeys across India with zero hallucinated prices or schedules.
2. When a user requests a journey (e.g., "Plan a 3-day trip from Delhi to Jaipur on Dec 5 for 2 people"):
   - Extract: origin, destination, departure date (YYYY-MM-DD), passenger count, and budget tier.
3. Actively utilize your available tools:
   - Live Transport: 'search_flights' and 'search_trains'.
   - Stays: 'search_hotels' to discover verified accommodation.
   - MCP Climate Intelligence: 'get_current_weather' and 'get_weather_forecast' to check live temperatures, rain percentages, and sightseeing advisories.
   - Spatial Optimization: 'optimize_itinerary' for zero-backtracking, day-by-day plans.
   - MCP Visuals & History: 'get_place_photos' and 'get_place_details' to embed real photographs and visitor tips.
4. CRITICAL RULES:
   - NEVER invent flight numbers, train numbers, or prices. Always call the tools.
   - If travel dates are relative (e.g. "next Friday"), compute the approximate YYYY-MM-DD date.
   - Always present prices in INR (₹).
   - Share the weather advisory (e.g., "Sunny, 24°C — great for outdoor forts").
   - Remind the user that bookings are confirmed securely via Razorpay.`;

function getAgentModel() {
  const apiKey = config.groqApiKey;
  if (!apiKey) {
    console.warn(
      "[AgentGraph] GROQ_API_KEY is not set in .env. Agent requests will fail unless API key is supplied."
    );
  }

  return new ChatGroq({
    apiKey: apiKey || "dummy_key",
    model: "llama-3.3-70b-versatile",
    temperature: 0.2
  });
}

let compiledApp = null;
let cachedTools = null;

/**
 * Initializes tools (including dynamic MCP discovery) and compiles LangGraph StateGraph.
 */
export async function getTravelAgentApp() {
  if (compiledApp) {
    return compiledApp;
  }

  try {
    cachedTools = await getCompleteAgentTools();
  } catch (err) {
    console.warn("[AgentGraph] Falling back to native tools:", err.message);
    cachedTools = nativeAgentTools;
  }

  async function callModelNode(state) {
    const model = getAgentModel();
    const modelWithTools = model.bindTools(cachedTools);

    const messages = state.messages || [];
    const systemMessage = new SystemMessage(SYSTEM_PROMPT);

    const response = await modelWithTools.invoke([systemMessage, ...messages]);
    return { messages: [response] };
  }

  function shouldContinue(state) {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.tool_calls && lastMessage.tool_calls.length > 0) {
      return "tools";
    }
    return END;
  }

  const workflow = new StateGraph(TripAgentState)
    .addNode("agent", callModelNode)
    .addNode("tools", new ToolNode(cachedTools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      [END]: END
    })
    .addEdge("tools", "agent");

  compiledApp = workflow.compile();
  return compiledApp;
}
