import type { GraphState } from '../state';

/** Debug: log graph node entry (requested for production tracing). */
export function logNodeEntry(nodeName: string, state: GraphState): void {
  console.log('[agent-node]', nodeName, {
    currentNode: state.currentNode ?? null,
    recommendationShown: Boolean(state.recommendationShown),
    colorSeason: state.colorSeason ?? null,
  });
}
