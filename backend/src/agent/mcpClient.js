import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mcpClientInstance = null;
let discoveredMCPTools = [];

/**
 * Initializes the MCP Client, connects to the MCP Server over stdio,
 * and dynamically discovers all published tools via client.listTools().
 */
export async function loadDynamicMCPTools() {
  if (discoveredMCPTools.length > 0) {
    return discoveredMCPTools;
  }

  try {
    const serverScriptPath = path.resolve(__dirname, "../mcp/weatherPlacesServer.js");

    // 1. Initialize StdioClientTransport targeting our MCP Server process
    const transport = new StdioClientTransport({
      command: process.execPath, // Node executable
      args: [serverScriptPath]
    });

    // 2. Initialize official MCP Client
    const client = new Client(
      {
        name: "yatra-agent-mcp-client",
        version: "1.0.0"
      },
      {
        capabilities: {}
      }
    );

    // 3. Establish JSON-RPC connection
    await client.connect(transport);
    mcpClientInstance = client;

    // 4. DYNAMIC DISCOVERY: Query the MCP server for its published tools
    const response = await client.listTools();
    const serverTools = response.tools || [];

    console.log(
      `[MCP Client] Connected to MCP Server. Dynamically discovered ${serverTools.length} tools:`,
      serverTools.map((t) => t.name)
    );

    // 5. Convert each MCP tool dynamically into a LangChain-compatible tool
    discoveredMCPTools = serverTools.map((mcpTool) => {
      return tool(
        async (inputArgs) => {
          try {
            let parsedArgs = inputArgs;
            if (typeof inputArgs === "string") {
              try {
                parsedArgs = JSON.parse(inputArgs);
              } catch {
                parsedArgs = { city: inputArgs, placeName: inputArgs };
              }
            } else if (typeof inputArgs !== "object" || inputArgs === null) {
              parsedArgs = {};
            }

            // Forward the tool execution request over JSON-RPC to the MCP Server
            const result = await mcpClientInstance.callTool({
              name: mcpTool.name,
              arguments: parsedArgs
            });

            if (result.isError) {
              return JSON.stringify({
                status: "error",
                message: result.content?.[0]?.text || "Tool execution failed"
              });
            }

            return result.content?.[0]?.text || JSON.stringify(result.content);
          } catch (err) {
            return JSON.stringify({ status: "error", message: err.message });
          }
        },
        {
          name: mcpTool.name,
          description: mcpTool.description,
          schema: z.record(z.any()).or(z.string()).optional()
        }
      );
    });

    return discoveredMCPTools;
  } catch (error) {
    console.error("[MCP Client] Failed to connect and discover tools:", error.message);
    return [];
  }
}
