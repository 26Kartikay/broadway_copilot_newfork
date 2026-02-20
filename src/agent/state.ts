import { PendingType, User } from '@prisma/client';
import { ColorWithHex, SeasonalPalette } from '../data/seasonalPalettes';
import { BaseMessage } from '../lib/ai';
import { MessageInput, QuickReplyButton } from '../lib/chat/types';
import { TraceBuffer } from './tracing';

export type { QuickReplyButton };

// ============================================================================
// AGENT STATE DEFINITION
// ============================================================================

/**
 * Defines the complete state for the agent's graph.
 * Includes all data required for processing a user request, from input to final reply.
 */
export interface GraphState {
  /** Unique identifier for the current graph execution run */
  graphRunId: string;

  /** Unique identifier for the current conversation */
  conversationId: string;

  /** The buffer for storing execution traces in-memory */
  traceBuffer: TraceBuffer;

  /** Message input that initiated the interaction */
  input: MessageInput;

  /** User profile information from the database */
  user: User;

  /** Full conversation history including images, for multimodal models */
  conversationHistoryWithImages: BaseMessage[];

  /** Text-only conversation history for faster, text-based models */
  conversationHistoryTextOnly: BaseMessage[];

  /** The user's primary intent (e.g., 'styling', 'general') */
  intent: IntentLabel | null;

  /** Specific sub-intent for styling requests */
  stylingIntent: StylingIntent | null;

  /** Specific sub-intent for Style Studio requests */
  subIntent?:
    | 'style_studio_occasion'
    | 'style_studio_vacation'
    | 'style_studio_general'
    | undefined;

  /** Specific sub-intent for general conversation */
  generalIntent: GeneralIntent | null;

  /** Field to be requested from the user if their profile is incomplete */
  missingProfileField: MissingProfileField | null;

  /** List of services available to the user based on cooldowns */
  availableServices: AvailableService[];

  /** The generated reply to be sent to the user */
  assistantReply: Replies | null;

  /** The pending action type, if the agent is waiting for user input */
  pending: PendingType | null;

  /** User's selected tonality for vibe check */
  selectedTonality: string | null;

  /** The payload from the last button click that successfully routed to a sub-intent */
  lastSubIntentPayload?: string | undefined;

  lastHandledPayload?: string | undefined;

  thisOrThatFirstImageId?: string | undefined;

  /** The seasonal palette to be saved, pending user confirmation. */
  seasonalPaletteToSave?: string | undefined;

  /** Context for product recommendations. */
  productRecommendationContext?:
    | {
        type: 'color_palette';
        paletteName: string;
      }
    | {
        type: 'vibe_check';
        recommendations: string[];
        identifiedOutfit?: string;
      }
    | undefined;

  /** Fetched color analysis data for use in product recommendations. */
  fetchedColorAnalysis?: any | undefined;

  /** Replies returned in the HTTP response */
  httpResponse?: Replies | undefined;

  /** Fashion quiz state */
  quizQuestions?: any[] | undefined;
  quizAnswers?: string[] | undefined;
  currentQuestionIndex?: number | undefined;
}

// ============================================================================
// STATE TYPES
// ============================================================================

/**
 * Available intent labels for routing user requests to appropriate handlers.
 * These define the main categories of user interactions the agent can handle.
 */
export type IntentLabel =
  | 'general'
  | 'vibe_check'
  | 'color_analysis'
  | 'style_studio'
  | 'styling'
  | 'this_or_that'
  | 'skin_lab'
  | 'fashion_quiz';

/**
 * Specific styling intents for fashion/styling related requests.
 * These are sub-categories under the main 'styling' intent.
 */
export type StylingIntent = 'occasion' | 'vacation' | 'pairing' | 'suggest';

/**
 * General conversation intents for non-styling related interactions.
 * These handle basic conversational flows like greetings and menu navigation.
 */
export type GeneralIntent = 'greeting' | 'menu' | 'chat' | 'tonality';

/**
 * Available services that can be offered to users.
 * Used for determining which features are accessible based on user state and cooldowns.
 */
export type AvailableService =
  | 'vibe_check'
  | 'occasion'
  | 'vacation'
  | 'color_analysis'
  | 'suggest'
  | 'style_studio'
  | 'style_studio_occasion'
  | 'style_studio_vacation'
  | 'style_studio_general'
  | 'this_or_that'
  | 'skin_lab';
/**
 * Product recommendation structure for displaying products from Broadway catalog.
 */
export interface ProductRecommendation {
  name: string;
  brand: string;
  imageUrl: string;
  description?: string | undefined;
  colors?: string[] | undefined;
  reason?: string;
}
export interface ScoringCategory {
  score: number;
  explanation: string;
}

/**
 * Standard reply structure for agent responses.
 * Defines the format for all message types the agent can send back to users.
 */
type Reply =
  | {
      reply_type: 'text';
      reply_text: string;
    }
  | {
      reply_type: 'quick_reply';
      reply_text: string;
      buttons: QuickReplyButton[];
    }
  | {
      reply_type: 'list_picker';
      reply_text: string;
      buttons: QuickReplyButton[];
    }
  | {
      reply_type: 'image';
      media_url: string;
      reply_text?: string;
    }
  | {
      reply_type: 'color_analysis_image_upload_request';
      reply_text: string;
    }
  | {
      reply_type: 'vibe_check_image_upload_request';
      reply_text: string;
    }
  | {
      reply_type: 'product_card';
      products: ProductRecommendation[];
      reply_text?: string;
    }
  | {
      reply_type: 'pdf';
      media_url: string;
      reply_text?: string;
    }
  | {
      reply_type: 'color_analysis_card';
      palette_name: SeasonalPalette;
      description: string;
      top_colors: ColorWithHex[];
      two_color_combos: ColorWithHex[][];
      user_image_url: string | null;
    }
  | {
      reply_type: 'vibe_check_card';
      comment: string;
      fit: ScoringCategory;
      hair_and_skin: ScoringCategory;
      accessories: ScoringCategory;
      vibe_check_result: number;
      recommendations: string[];
      user_image_url: string | null;
    };

/**
 * Array of reply structures that define a complete agent response.
 * Multiple replies allow for complex interactions like image + text + quick replies.
 */
export type Replies = Reply[];

/**
 * Missing profile fields that need to be collected from the user.
 * Used to determine if the user needs to provide more information to fulfill the request.
 */
export type MissingProfileField = 'gender' | 'fitPreference';
