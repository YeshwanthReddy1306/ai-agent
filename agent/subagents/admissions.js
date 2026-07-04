/**
 * Admissions Agent (Sub-Agent 1)
 * Handles: First Response, FAQs, Brochure Sharing
 */

const { generateAgentResponse } = require('./llm_helper');

const callAdmissionsAgent = async (state) => {
  console.log("[Admissions Agent] Processing state:", state.session_id);
  
  const lastMessage = state.messages[state.messages.length - 1];
  const text = lastMessage?.content || "";
  
  let nextAction = "gather_info";
  let stage = state.current_stage;
  let intent = "inquiry";
  
  if (text.toLowerCase().includes("fee") || text.toLowerCase().includes("cost")) {
    intent = "pricing";
    stage = "objection";
  } else if (text.toLowerCase().includes("visit") || text.toLowerCase().includes("campus")) {
    intent = "book_visit";
    stage = "closing";
  }
  
  // Generate response
  const { text: responseText, usage } = await generateAgentResponse(state);
  
  return {
    intent,
    current_stage: stage,
    next_action: nextAction,
    messages: [{ role: "assistant", content: responseText }],
    turn_usage: usage
  };
};

module.exports = { callAdmissionsAgent };
