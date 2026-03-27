import { GraphState } from '../state';

/**
 * Supervisor node: Routes the flow based on the Planner's decision.
 * This can chain multiple tools or skip them.
 */
export function supervisor(state: GraphState): string {
  const { plan } = state;

  if (!plan) {
    return 'contextBuilder';
  }

  const action = plan.actions[0];

  switch (action) {
    case 'main_menu':
    case 'menu':
      return 'handleGeneral';
    case 'vibe_check':
      return 'vibeCheck';
    case 'color_analysis':
      return 'colorAnalysis';
    case 'styling':
      return 'handleStyling';
    case 'style_studio':
      return 'handleStyleStudio';
    case 'this_or_that':
      return 'handleThisOrThat';
    case 'skin_lab':
      return 'handleSkinLab';
    case 'fashion_quiz':
      return 'handleFashionCharades';
    default:
      return 'contextBuilder';
  }
}
