/**
 * Shared constants used across the application.
 */

/**
 * Media links
 */
export const WELCOME_IMAGE_URL =
  'https://res.cloudinary.com/drpb2m2ar/image/upload/v1760700332/AI_Chatbot_Cover_img_odzhae.png';
export const MESSAGE_TTL_SECONDS = 60 * 60; // 1 hour
export const USER_STATE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Rate limiting
 */
export const USER_REQUEST_LIMIT = 5;
export const TOKEN_REFILL_PERIOD_MS = 10 * 1000;
