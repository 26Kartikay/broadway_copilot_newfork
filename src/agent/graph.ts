import { PendingType } from '@prisma/client';
import { END, START, StateGraph } from '../lib/graph';
import {
  askUserInfo,
  colorAnalysis,
  dailyFact,
  handleFashionCharades,
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
  handleSkinLab,
  handleThisOrThat,
} from './nodes';
import { GraphState } from './state';

export function buildAgentGraph() {
  const graph = new StateGraph<GraphState>()
    .addNode('ingestMessage', ingestMessage)
    .addNode('recordUserInfo', recordUserInfo)
    .addNode('routeIntent', routeIntent)
    .addNode('routeGeneral', routeGeneral)
    .addNode('askUserInfo', askUserInfo)
    .addNode('handleStyling', handleStyling) 
    .addNode('handleFeedback', handleFeedback)
    .addNode('vibeCheck', vibeCheck)
    .addNode('colorAnalysis', colorAnalysis)
    .addNode('handleGeneral', handleGeneral)
    .addNode('sendReply', sendReply)
    .addNode('routeStyleStudio', routeStyleStudio)
    .addNode('handleStyleStudio', handleStyleStudio)
    .addNode('dailyFact', dailyFact)
    .addNode('handleFashionCharades', handleFashionCharades)
    .addNode('handleSkinLab', handleSkinLab)
    .addNode('handleThisOrThat', handleThisOrThat)
    .addEdge(START, 'ingestMessage')
    .addConditionalEdges(
      'ingestMessage',
      (s: GraphState) => {
        if (s.pending === PendingType.ASK_USER_INFO) return 'recordUserInfo';
        if (s.pending === PendingType.FEEDBACK) return 'handleFeedback';
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
        if (s.missingProfileField) return 'askUserInfo';
        switch (s.intent) {
          case 'skin_lab':
            return 'handleSkinLab';
          case 'this_or_that':
            return 'handleThisOrThat';
          case 'fashion_quiz':
            return 'handleFashionCharades';
          default:
            return s.intent || 'general';
        }
      },
      {
        askUserInfo: 'askUserInfo',
        general: 'routeGeneral',
        vibe_check: 'vibeCheck',
        color_analysis: 'colorAnalysis',
        styling: 'routeStyleStudio',
        style_studio: 'routeStyleStudio',
        handleSkinLab: 'handleSkinLab',
    handleThisOrThat: 'handleThisOrThat',
    handleFashionCharades: 'handleFashionCharades',
      },
    )
    .addEdge('routeGeneral', 'handleGeneral')
    .addConditionalEdges(
  'routeStyleStudio',
  (s: GraphState) => {
    // If user picked Style Studio from the list, show menu
    if (s.input?.ButtonPayload === 'style_studio') return 'sendReply';

    // If a sub-intent was selected (occasion, vacation, etc.)
    if (s.subIntent) return 'handleStyleStudio';

    // If there’s already a prepared reply, just send it
    if (s.assistantReply && s.assistantReply.length > 0) return 'sendReply';

    // Default fallback
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
    .addEdge('handleStyling', 'sendReply')
    .addEdge('colorAnalysis', 'sendReply')
    .addEdge('handleGeneral', 'sendReply')
    .addEdge('handleFeedback', 'sendReply')
    .addEdge('handleFashionCharades', 'sendReply')
    .addEdge('handleSkinLab', 'sendReply')
    .addEdge('handleThisOrThat', 'sendReply')
    .addEdge('sendReply', END);

  return graph.compile();
}
