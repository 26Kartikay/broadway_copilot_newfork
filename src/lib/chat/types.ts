/**
 * Type definitions for the HTTP Chat API.
 *
 * This module provides strongly-typed interfaces for handling chat requests
 * and responses through the HTTP API endpoint.
 */

// ================================
// Request Types
// ================================

/**
 * Represents a media attachment in a chat message.
 */
export interface MediaAttachment {
  /** URL to the media file */
  url: string;
  /** MIME type of the media (e.g., 'image/jpeg') */
  contentType?: string;
}

/**
 * Represents a button interaction from the user.
 */
export interface ButtonInput {
  /** Display text of the button */
  text?: string;
  /** Payload/identifier of the button */
  payload?: string;
  /** Type of button interaction */
  type?: string;
}

/**
 * Incoming chat request payload from the client.
 *
 * This is the primary input structure for the /api/chat endpoint.
 */
export interface ChatRequest {
  /** Unique identifier for the user */
  userId: string;
  /** Text content of the message */
  text?: string;
  /** Array of media attachments */
  media?: MediaAttachment[];
  /** Button interaction data */
  button?: ButtonInput;
  /** User's display name */
  profileName?: string;
  /** Optional client-provided message ID */
  messageId?: string;
}

/**
 * Internal message input format used by the agent graph.
 *
 * This structure is used internally after normalizing the ChatRequest.
 * It maintains compatibility with the existing graph while removing
 * Twilio-specific fields.
 */
export interface MessageInput {
  /** Unique message identifier */
  MessageSid: string;
  /** Alias for MessageSid (legacy compatibility) */
  SmsSid: string;
  /** Alias for MessageSid (legacy compatibility) */
  SmsMessageSid: string;
  /** Account identifier (set to 'APP' for HTTP requests) */
  AccountSid: string;
  /** Sender identifier in format 'app:{userId}' */
  From: string;
  /** Recipient identifier (set to 'app:server') */
  To: string;
  /** Text content of the message */
  Body: string;
  /** Number of media attachments as string */
  NumMedia: string;
  /** Number of message segments (always '1' for HTTP) */
  NumSegments: string;
  /** Message status (set to 'received' for incoming) */
  SmsStatus: string;
  /** API version identifier */
  ApiVersion: string;

  /** User's display name */
  ProfileName?: string;
  /** User identifier (same as userId from ChatRequest) */
  WaId?: string;

  /** Button text from quick reply interaction */
  ButtonText?: string;
  /** Button payload from quick reply interaction */
  ButtonPayload?: string;
  /** Type of message/interaction */
  MessageType?: string;

  /** First media URL */
  MediaUrl0?: string;
  /** First media content type */
  MediaContentType0?: string;

  /** Index signature for dynamic media parameters (MediaUrl1, etc.) */
  [key: string]: string | undefined;
}

// ================================
// Response Types
// ================================

/**
 * Represents a quick reply button in a response.
 */
export interface QuickReplyButton {
  /** Display text for the button */
  text: string;
  /** Unique identifier for the button */
  id: string;
}

/**
 * Union type for different reply formats with clear UI expectations.
 *
 * Each reply type indicates exactly what the frontend should render:
 * - 'text_only': Plain text message
 * - 'text_with_buttons': Text message with action buttons below
 * - 'buttons_only': Just buttons (no text), implies quick reply interface
 * - 'image_with_caption': Image with optional caption text
 * - 'carousel': Multiple items/cards (for future use)
 */
export type Reply =
  | {
      /** Plain text message - render as simple text bubble */
      reply_type: 'text_only';
      /** The text content to display */
      reply_text: string;
      /** Expected user action: 'continue' | 'wait' | 'input_required' */
      expected_action?: 'continue' | 'wait' | 'input_required';
    }
  | {
      /** Text with interactive buttons - render text above button row */
      reply_type: 'text_with_buttons';
      /** Main message text */
      reply_text: string;
      /** Action buttons for user interaction */
      buttons: QuickReplyButton[];
      /** Expected user action: 'button_click' | 'input_required' */
      expected_action?: 'button_click' | 'input_required';
    }
  | {
      /** Quick reply buttons only - render as floating/quick reply buttons */
      reply_type: 'buttons_only';
      /** No text content (buttons imply the message) */
      reply_text?: string;
      /** Quick reply buttons */
      buttons: QuickReplyButton[];
      /** Expected user action: 'button_click' */
      expected_action?: 'button_click';
    }
  | {
      /** Image with optional caption - render as media message */
      reply_type: 'image_with_caption';
      /** Image URL */
      media_url: string;
      /** Optional caption text below image */
      reply_text?: string;
      /** Expected user action: 'continue' | 'feedback' */
      expected_action?: 'continue' | 'feedback';
    }
  | {
      /** Multiple items carousel - for future use */
      reply_type: 'carousel';
      /** Carousel items (structure TBD) */
      items: any[];
      /** Expected user action: 'item_select' */
      expected_action?: 'item_select';
    };

/**
 * Array of replies that make up a complete response.
 */
export type Replies = Reply[];

/**
 * Response metadata providing context about the conversation state.
 */
export interface ResponseMetadata {
  /** Current conversation session state */
  session_state?: 'initial' | 'active' | 'awaiting_input' | 'completed';
  /** Whether the bot is still processing (streaming responses) */
  is_streaming?: boolean;
  /** Estimated processing time remaining in seconds */
  processing_time_remaining?: number;
  /** Unique conversation ID for tracking */
  conversation_id?: string;
  /** Timestamp of the response */
  timestamp?: string;
}

/**
 * Response structure for the /api/chat endpoint.
 *
 * Frontend should handle each reply based on its reply_type:
 * - text_only: Simple text display
 * - text_with_buttons: Text + button grid below
 * - buttons_only: Quick reply buttons (floating/suggested)
 * - image_with_caption: Media display with caption
 */
export interface ChatResponse {
  /** Array of reply messages with clear UI expectations */
  replies: Replies;
  /** Pending action type, if any (legacy - use metadata.session_state) */
  pending: string | null;
  /** Additional response context and metadata */
  metadata?: ResponseMetadata;
}

// ================================
// Validation & Examples
// ================================

/**
 * Validates a ChatRequest for common issues.
 *
 * @param request - The request to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateChatRequest(request: ChatRequest): string[] {
  const errors: string[] = [];

  if (!request.userId || typeof request.userId !== 'string') {
    errors.push('userId is required and must be a string');
  }

  // Check mutually exclusive fields
  const hasText = request.text && request.text.trim().length > 0;
  const hasMedia = request.media && request.media.length > 0;
  const hasButton = request.button;

  if (!hasText && !hasMedia && !hasButton) {
    errors.push('Request must contain at least one of: text, media, or button');
  }

  // Validate media attachments
  if (request.media) {
    request.media.forEach((media, index) => {
      if (!media.url || typeof media.url !== 'string') {
        errors.push(`Media attachment ${index} must have a valid url`);
      }
    });
  }

  // Validate button interaction
  if (request.button) {
    if (request.button.payload && !request.button.text) {
      errors.push('Button interaction with payload should include text');
    }
  }

  return errors;
}

/**
 * Type guard to check if a reply is text-only.
 */
export function isTextOnlyReply(reply: Reply): reply is Extract<Reply, { reply_type: 'text_only' }> {
  return reply.reply_type === 'text_only';
}

/**
 * Type guard to check if a reply has buttons.
 */
export function isButtonReply(reply: Reply): reply is Extract<Reply, { buttons: QuickReplyButton[] }> {
  return 'buttons' in reply && Array.isArray(reply.buttons);
}

/**
 * Type guard to check if a reply has media.
 */
export function isMediaReply(reply: Reply): reply is Extract<Reply, { media_url: string }> {
  return 'media_url' in reply;
}

// ================================
// Examples & Documentation
// ================================

/**
 * Example ChatRequest for sending a text message.
 */
export const EXAMPLE_TEXT_REQUEST: ChatRequest = {
  userId: 'user123',
  text: 'Hello, I need styling advice',
  messageId: 'msg_001'
};

/**
 * Example ChatRequest for sending media.
 */
export const EXAMPLE_MEDIA_REQUEST: ChatRequest = {
  userId: 'user123',
  text: 'What do you think of this outfit?',
  media: [{
    url: 'https://example.com/image.jpg',
    contentType: 'image/jpeg'
  }],
  messageId: 'msg_002'
};

/**
 * Example ChatRequest for button interaction.
 */
export const EXAMPLE_BUTTON_REQUEST: ChatRequest = {
  userId: 'user123',
  button: {
    text: 'Yes, show me more',
    payload: 'confirm_more_styles',
    type: 'quick_reply'
  },
  messageId: 'msg_003'
};

/**
 * Example ChatResponse with different reply types.
 */
export const EXAMPLE_CHAT_RESPONSE: ChatResponse = {
  replies: [
    // Text-only greeting
    {
      reply_type: 'text_only',
      reply_text: 'Hello! I\'m your personal stylist. What can I help you with today?',
      expected_action: 'input_required'
    },
    // Quick reply buttons
    {
      reply_type: 'buttons_only',
      buttons: [
        { text: 'Find outfit ideas', id: 'outfit_ideas' },
        { text: 'Style my photo', id: 'style_photo' },
        { text: 'Color analysis', id: 'color_analysis' }
      ],
      expected_action: 'button_click'
    }
  ],
  pending: null,
  metadata: {
    session_state: 'initial',
    conversation_id: 'conv_123',
    timestamp: new Date().toISOString()
  }
};

// ================================
// Helper Functions
// ================================

/**
 * Converts a ChatRequest into the internal MessageInput format.
 *
 * @param request - The incoming chat request
 * @param messageId - Generated or provided message ID
 * @returns MessageInput compatible with the agent graph
 */
export function chatRequestToMessageInput(
  request: ChatRequest,
  messageId: string,
): MessageInput {
  const input: MessageInput = {
    MessageSid: messageId,
    SmsSid: messageId,
    SmsMessageSid: messageId,
    AccountSid: 'APP',
    From: `app:${request.userId}`,
    To: 'app:server',
    Body: String(request.text ?? ''),
    NumMedia: Array.isArray(request.media) ? String(request.media.length) : '0',
    NumSegments: '1',
    SmsStatus: 'received',
    ApiVersion: '2010-04-01',
    WaId: String(request.userId),
  };

  // Set optional string properties only if they have values
  if (request.profileName !== undefined) {
    input.ProfileName = request.profileName;
  }

  // Map media array to MediaUrl0, MediaContentType0, etc.
  if (Array.isArray(request.media)) {
    request.media.slice(0, 10).forEach((m, index) => {
      input[`MediaUrl${index}`] = m.url;
      if (m.contentType) {
        input[`MediaContentType${index}`] = m.contentType;
      }
    });
  }

  // Map button to ButtonText/Payload if provided
  if (request.button) {
    if (request.button.text !== undefined) {
      input.ButtonText = request.button.text;
    }
    if (request.button.payload !== undefined) {
      input.ButtonPayload = request.button.payload;
    }
    input.MessageType = request.button.type || 'quick_reply';
  }

  return input;
}
