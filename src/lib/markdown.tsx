import { type ReactNode } from "react";
import { decodeEntities } from "./utils";

/** Lightweight markdown renderer for AI chat messages.
 *  Handles: **bold**, *italic*, `code`, bullet lists, numbered lists. */
export function renderMarkdown(text: string): ReactNode {
  const blocks = text.split(/\n{2,}/);
  const elements: ReactNode[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) continue;
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split("\n");

    // Check if this block is a bullet list
    const isBulletList = lines.every((l) => /^\s*[-*]\s/.test(l));
    if (isBulletList) {
      elements.push(
        <ul key={i} className="my-1 ml-4 list-disc space-y-0.5">
          {lines.map((line, j) => (
            <li key={j}>{renderInline(line.replace(/^\s*[-*]\s+/, ""))}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Check if this block is a numbered list
    const isNumberedList = lines.every((l) => /^\s*\d+[.)]\s/.test(l));
    if (isNumberedList) {
      elements.push(
        <ol key={i} className="my-1 ml-4 list-decimal space-y-0.5">
          {lines.map((line, j) => (
            <li key={j}>{renderInline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Regular paragraph — preserve line breaks within it
    elements.push(
      <p key={i} className="whitespace-pre-wrap">
        {renderInline(trimmed)}
      </p>
    );
  }

  return <>{elements}</>;
}

/** Render inline markdown: **bold**, *italic*, `code` */
function renderInline(text: string): ReactNode {
  // Split by inline patterns, preserving the matched groups
  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Try to match inline patterns in order
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/s);
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/);
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/s);
    const emDashItalicMatch = remaining.match(/^(.*?)_(.+?)_/s);

    // Find the earliest match
    type Match = { type: "bold" | "code" | "italic"; match: RegExpMatchArray };
    const candidates: Match[] = [];
    if (boldMatch?.[1] !== undefined) candidates.push({ type: "bold", match: boldMatch });
    if (codeMatch?.[1] !== undefined) candidates.push({ type: "code", match: codeMatch });
    if (italicMatch?.[1] !== undefined && !boldMatch) candidates.push({ type: "italic", match: italicMatch });
    if (emDashItalicMatch?.[1] !== undefined && !boldMatch) candidates.push({ type: "italic", match: emDashItalicMatch });

    // Sort by position (length of prefix text)
    candidates.sort((a, b) => (a.match[1]?.length ?? 0) - (b.match[1]?.length ?? 0));

    const best = candidates[0];
    if (!best) {
      // No more inline patterns
      parts.push(decodeEntities(remaining));
      break;
    }

    const prefix = best.match[1] ?? "";
    const inner = best.match[2] ?? "";

    if (prefix) {
      parts.push(decodeEntities(prefix));
    }

    switch (best.type) {
      case "bold":
        parts.push(<strong key={key++}>{decodeEntities(inner)}</strong>);
        remaining = remaining.slice(prefix.length + inner.length + 4); // 4 = ** + **
        break;
      case "code":
        parts.push(
          <code key={key++} className="rounded bg-stone-200 px-1 py-0.5 text-xs dark:bg-stone-700">
            {inner}
          </code>
        );
        remaining = remaining.slice(prefix.length + inner.length + 2); // 2 = ` + `
        break;
      case "italic": {
        const marker = best.match[0]?.includes("_") ? "_" : "*";
        parts.push(<em key={key++}>{decodeEntities(inner)}</em>);
        remaining = remaining.slice(prefix.length + inner.length + (marker.length * 2));
        break;
      }
    }
  }

  return <>{parts}</>;
}
