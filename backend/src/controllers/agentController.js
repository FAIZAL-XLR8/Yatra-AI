import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { getTravelAgentApp } from "../agent/graph.js";
import { config } from "../config/env.js";

/**
 * Controller for conversational AI travel planning.
 * @route POST /api/agent/chat
 */
export async function chatWithAgent(req, res) {
  try {
    const { message, tripId = null, history = [] } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ message: "Message text is required." });
    }

    if (!config.groqApiKey) {
      return res.status(503).json({
        message: "GROQ_API_KEY is missing in backend .env. Please configure it to enable the AI agent."
      });
    }

    // Convert past history into LangChain messages
    const formattedMessages = [];
    if (Array.isArray(history)) {
      for (const msg of history) {
        if (msg.role === "user" || msg.sender === "user") {
          formattedMessages.push(new HumanMessage(msg.content || msg.text));
        } else if (msg.role === "assistant" || msg.sender === "agent") {
          formattedMessages.push(new AIMessage(msg.content || msg.text));
        }
      }
    }

    // Add current user prompt
    formattedMessages.push(new HumanMessage(message));

    // Execute compiled LangGraph agent workflow
    const app = await getTravelAgentApp();
    const result = await app.invoke({
      messages: formattedMessages,
      tripId: tripId || null
    });

    const finalMessages = result.messages || [];
    const lastMessage = finalMessages[finalMessages.length - 1];

    // Collect any tool calls that were executed
    const toolExecutions = [];
    for (const msg of finalMessages) {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        toolExecutions.push(...msg.tool_calls.map((t) => t.name));
      }
    }

    res.status(200).json({
      reply: lastMessage?.content || "I have processed your request.",
      tripId: result.tripId || tripId,
      toolsUsed: [...new Set(toolExecutions)]
    });
  } catch (error) {
    console.error("[AgentController] Error during agent execution:", error);
    res.status(500).json({
      message: error.message || "Failed to process message with AI travel agent."
    });
  }
}

/**
 * Health & Config check for the AI agent service.
 * @route GET /api/agent/status
 */
export async function getAgentStatus(req, res) {
  const isConfigured = Boolean(config.groqApiKey);
  res.status(200).json({
    status: isConfigured ? "ready" : "missing_api_key",
    model: "llama-3.3-70b-versatile (via Groq)",
    framework: "LangGraph.js",
    hasGroqKey: isConfigured
  });
}
