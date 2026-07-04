const { executor } = require('./executor');

const tools = [
  {
    type: "function",
    function: {
      name: "appointment",
      description: "Book a campus visit or counseling appointment.",
      parameters: {
        type: "object",
        properties: {
          branch: { type: "string", description: "Branch location (e.g., HYD-KUKATPALLY)" },
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          time: { type: "string", description: "Time in HH:MM format" },
          type: { type: "string", description: "Type: campus_visit, counseling, or test" }
        },
        required: ["branch", "date", "time", "type"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crm",
      description: "Update the CRM with lead details.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "10-digit phone number" },
          program: { type: "string", description: "Program of interest: MPC or BiPC" },
          status: { type: "string", description: "Lead status (e.g., qualified)" }
        },
        required: ["phone", "program", "status"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "whatsapp",
      description: "Send a WhatsApp message or brochure.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "10-digit phone number" },
          message: { type: "string", description: "Message content" }
        },
        required: ["phone", "message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "knowledge",
      description: "Query dynamic knowledge (fees, scholarships, deadlines, branches).",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Knowledge category: fees, scholarships, deadlines, or branches" }
        },
        required: ["category"]
      }
    }
  }
];

module.exports = { tools, executor };
