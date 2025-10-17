import { PendingType } from '@prisma/client';
import { END, START, StateGraph } from '../lib/graph';
import {
  askUserInfo,
  colorAnalysis,
  dailyFact,
  handleFeedback,
  handleGeneral,
  handleStyleStudio,
  handleStyling,
  ingestMessage,
  recordUserInfo,
  routeGeneral,
  routeIntent,
  routeStyleStudio,
  sendReply,
  vibeCheck,
} from './nodes';
import { GraphState } from './state';

export function buildAgentGraph() {
  const graph = new StateGraph<GraphState>()
    .addNode('ingestMessage', ingestMessage)
    .addNode('recordUserInfo', recordUserInfo)
    .addNode('routeIntent', routeIntent)
    .addNode('routeGeneral', routeGeneral)
    .addNode('askUserInfo', askUserInfo)
    .addNode('handleStyling', handleStyling) // you may keep if needed for compatibility, else can remove
    .addNode('handleFeedback', handleFeedback)
    .addNode('vibeCheck', vibeCheck)
    .addNode('colorAnalysis', colorAnalysis)
    .addNode('handleGeneral', handleGeneral)
    .addNode('sendReply', sendReply)
    .addNode('routeStyleStudio', routeStyleStudio)  // Added node for style studio routing
    .addNode('handleStyleStudio', handleStyleStudio)
    .addNode('dailyFact', dailyFact)
    .addEdge(START, 'ingestMessage')
    .addConditionalEdges(
      'ingestMessage',
      (s: GraphState) => {
        if (s.pending === PendingType.ASK_USER_INFO) {
          return 'recordUserInfo';
        }
        if (s.pending === PendingType.FEEDBACK) {
          return 'handleFeedback';
        }
        return 'routeIntent';
      },
      {
        recordUserInfo: 'recordUserInfo',
        handleFeedback: 'handleFeedback',
        routeIntent: 'routeIntent',
      },
    )
    .addEdge('recordUserInfo', 'routeIntent')
    .addConditionalEdges(
      'routeIntent',
      (s: GraphState) => {
        if (s.missingProfileField) {
          return 'askUserInfo';
        }
        return s.intent || 'general';
      },
      {
        askUserInfo: 'askUserInfo',
        general: 'routeGeneral',
        vibe_check: 'vibeCheck',
        color_analysis: 'colorAnalysis',
        // Route all styling-related intents exclusively to Style Studio
        styling: 'routeStyleStudio',
        style_studio: 'routeStyleStudio',
      },
    )
    .addEdge('routeGeneral', 'handleGeneral')
    .addConditionalEdges(
  'routeStyleStudio',
  (s: GraphState) => {
    // 1. If routeStyleStudio prepared a reply (the menu), send it now.
    if (s.assistantReply && s.assistantReply.length > 0) {
      return 'sendReply';
    }
    // 2. If a sub-intent was set (user clicked a sub-menu button), proceed to the handler.
    if (s.subIntent) {
      return 'handleStyleStudio';
    }
    // 3. Fallback: If neither a reply nor a sub-intent was set, assume general chat.
    return 'routeGeneral'; 
  },
  {
    sendReply: 'sendReply',
    handleStyleStudio: 'handleStyleStudio',
    routeGeneral: 'routeGeneral',
  },
)
    .addEdge('vibeCheck', 'sendReply')
    .addEdge('askUserInfo', 'sendReply')
    .addEdge('handleStyleStudio', 'sendReply')
    .addEdge('handleStyling', 'sendReply')  // You may remove this if you fully drop old styling flow
    .addEdge('colorAnalysis', 'sendReply')
    .addEdge('handleGeneral', 'sendReply')
    .addEdge('handleFeedback', 'sendReply')
    .addEdge('sendReply', END);

  return graph.compile();
}
