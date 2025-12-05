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
 * Union type for different reply formats.
 */
export type Reply =
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
    };

/**
 * Array of replies that make up a complete response.
 */
export type Replies = Reply[];

/**
 * Response structure for the /api/chat endpoint.
 */
export interface ChatResponse {
  /** Array of reply messages */
  replies: Replies;
  /** Pending action type, if any */
  pending: string | null;
}

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

