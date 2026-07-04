const { StateGraph, START, END } = require("@langchain/langgraph");
const { StateAnnotation } = require("./state");
const { callAdmissionsAgent } = require("./subagents/admissions");

// Define the Graph with a single agent
const workflow = new StateGraph(StateAnnotation)
  .addNode("admissions", callAdmissionsAgent)
  
  // Entry point
  .addEdge(START, "admissions")
  
  // Return control after agent finishes
  .addEdge("admissions", END);

// Compile the graph
const graph = workflow.compile();

module.exports = { graph };
