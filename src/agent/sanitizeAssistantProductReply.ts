/**
 * Strip markdown / SKU noise from assistant replies when product cards carry images & links.
 */
export function sanitizeAssistantProductReply(text: string): string {
  let s = text.replace(/\r\n/g, '\n');

  // Markdown images e.g. ![SKU xyz](https://...)
  s = s.replace(/!\[[^\]]*?\]\([^)]*\)/g, '');

  // Lines that only repeat SKU/catalog ids (bullet or numbered)
  const lines = s.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      kept.push(line);
      continue;
    }
    if (/^!\[[^\]]*\]\(/.test(t)) continue;
    if (/^\d+\.\s*SKU\b/i.test(t)) continue;
    if (/^[-*]\s*SKU\b/i.test(t)) continue;
    if (/^SKU\s+[A-Za-z0-9][A-Za-z0-9_-]{3,}\s*$/i.test(t)) continue;
    kept.push(line);
  }
  s = kept.join('\n');

  // Stray parentheses from broken markdown
  s = s.replace(/\n\s*\)\s*\n/g, '\n');

  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}
