import { buildAgentGraph } from './graph';
import type { GraphState } from './state';

export async function runAgentNode(initialState: GraphState): Promise<GraphState> {
  const graph = buildAgentGraph();
  const updatedState = await graph.invoke(initialState);
  return updatedState;
}
