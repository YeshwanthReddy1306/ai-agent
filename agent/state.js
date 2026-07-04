const { Annotation } = require("@langchain/langgraph");

// This defines the working memory (Conversation State) for the entire session.
// It maps directly to Fix 8 (Conversation State Schema) from the v7.1 MVP Plan.
const StateAnnotation = Annotation.Root({
  // The unique session ID (e.g., caller phone number)
  session_id: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "default_session"
  }),
  
  // Array of message objects (role, content, etc.)
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),
  
  // Current stage: greeting, information, objection, closing, completed
  current_stage: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "greeting"
  }),
  
  // Trust level score (0.0 to 1.0)
  trust_level: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => 0.5
  }),
  
  // Detected intent (e.g., "inquiry", "book_visit", "complaint")
  intent: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "unknown"
  }),
  
  // Overall goal of this conversation
  goal: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "capture_lead"
  }),
  
  // JSON object tracking pending tasks (e.g., { brochure_sent: false })
  pending_tasks: Annotation({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({})
  }),
  
  // Next action determined by the planner
  next_action: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "gather_info"
  }),
  
  // Confidence score of the active agent (0.0 to 1.0)
  confidence: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => 1.0
  }),
  
  // Final outcome: brochure_sent, visit_booked, follow_up, escalated, completed
  outcome: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "pending"
  }),
  
  // Lead ID (UUID) if known
  lead_id: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null
  }),

  // Current persona language (e.g. 'en-IN', 'te-IN')
  personaLang: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "en-IN"
  }),

  // Accumulated LLM usage from this turn
  turn_usage: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => ({ total_tokens: 0 })
  })
});

module.exports = { StateAnnotation };
