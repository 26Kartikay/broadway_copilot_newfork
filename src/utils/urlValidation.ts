/**
 * Validates if a string is a valid URL for images.
 * Accepts data URLs, HTTP/HTTPS URLs with valid hostnames, and relative paths (starting with `/`).
 *
 * @param url - The URL string to validate
 * @returns true if the URL is valid, false otherwise
 */
export function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Allow relative URLs served by this app (e.g. /uploads/..., /images/...)
  if (trimmed.startsWith('/')) return true;

  try {
    // Check if it's a data URL
    if (trimmed.startsWith('data:')) {
      return trimmed.includes(',');
    }
    // Check if it's a valid HTTP/HTTPS URL with a hostname
    const urlObj = new URL(trimmed);
    return (
      (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') && urlObj.hostname.length > 0
    );
  } catch {
    return false;
  }
}
