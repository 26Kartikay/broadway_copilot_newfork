import { PendingType } from '@prisma/client';
import { END, START, StateGraph } from '../lib/graph';
import {
  colorAnalysis,
  dailyFact,
  fetchColorAnalysisOnIntent,
  generateFollowUp,
  handleFashionCharades,
  handleFeedback,
  handleGeneral,
  handleProductRecommendationConfirmation,
  handleSaveColorAnalysis,
  handleSkinLab,
  handleStyleStudio,
  handleStyling,
  handleThisOrThat,
  ingestMessage,
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
    .addNode('routeIntent', routeIntent)
    .addNode('routeGeneral', routeGeneral)
    .addNode('handleStyling', handleStyling)
    .addNode('handleFeedback', handleFeedback)
    .addNode('vibeCheck', vibeCheck)
    .addNode('colorAnalysis', colorAnalysis)
    .addNode('handleSaveColorAnalysis', handleSaveColorAnalysis)
    .addNode('fetchColorAnalysisOnIntent', fetchColorAnalysisOnIntent)
    .addNode('handleProductRecommendationConfirmation', handleProductRecommendationConfirmation)
    .addNode('handleGeneral', handleGeneral)
    .addNode('generateFollowUp', generateFollowUp)
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
        switch (s.pending) {
          case PendingType.FEEDBACK:
            return 'handleFeedback';
          case PendingType.SAVE_COLOR_ANALYSIS:
            return 'handleSaveColorAnalysis';
          case PendingType.CONFIRM_PRODUCT_RECOMMENDATION:
            return 'fetchColorAnalysisOnIntent';
          default:
            return 'routeIntent';
        }
      },
      {
        handleFeedback: 'handleFeedback',
        handleSaveColorAnalysis: 'handleSaveColorAnalysis',
        fetchColorAnalysisOnIntent: 'fetchColorAnalysisOnIntent',
        routeIntent: 'routeIntent',
      },
    )
    .addEdge('fetchColorAnalysisOnIntent', 'handleProductRecommendationConfirmation')
    .addConditionalEdges(
      'routeIntent',
      (s: GraphState) => {
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
    // Route all handler nodes through generateFollowUp before sendReply
    .addEdge('vibeCheck', 'generateFollowUp')
    .addEdge('handleStyleStudio', 'generateFollowUp')
    .addEdge('handleStyling', 'generateFollowUp')
    .addEdge('colorAnalysis', 'generateFollowUp')
    .addEdge('handleGeneral', 'generateFollowUp')
    .addEdge('handleFeedback', 'generateFollowUp')
    .addEdge('handleFashionCharades', 'generateFollowUp')
    .addEdge('handleSkinLab', 'generateFollowUp')
    .addEdge('handleThisOrThat', 'generateFollowUp')
    .addEdge('handleSaveColorAnalysis', 'generateFollowUp')
    .addEdge('handleProductRecommendationConfirmation', 'generateFollowUp')
    // Then route from generateFollowUp to sendReply
    .addEdge('generateFollowUp', 'sendReply')
    .addEdge('sendReply', END);

  return graph.compile();
}
