/**
 * Helpers for putting scraped or user-supplied text into a model prompt.
 * Wrap the text in a named block, strip any copy of that block's tags from
 * the text first so it cannot close the block early, and say in the system
 * prompt that the block is data, not instructions.
 */

export function stripBlockTags(text: string, tags: string[]): string {
  const pattern = new RegExp(`<\\/?\\s*(?:${tags.join("|")})\\b[^>]*>`, "gi");
  return text.replace(pattern, " ");
}

export function wrapUntrusted(tag: string, text: string, allTags: string[] = [tag]): string {
  return `<${tag}>\n${stripBlockTags(text, allTags)}\n</${tag}>`;
}
