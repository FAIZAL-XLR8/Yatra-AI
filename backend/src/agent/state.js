
import { Annotation } from "@langchain/langgraph";

/**
 * LangGraph Agent State Schema for Yatra AI.
 * Tracks conversation messages, extracted trip specification, active tripId, and workflow phase.
 */
export const TripAgentState = Annotation.Root({
  // Append-only message history
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),

  // Extracted user travel preferences & intent
  tripSpec: Annotation({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({})
  }),

  // Linked MongoDB trip document ID
  tripId: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null
  }),

  // Current agent intent / status
  workflowStage: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "DISCOVERY"
  })
});
