const HEADINGS = new Set([
  "l'ouverture", "le portrait", "l'epreuve", "la transmission", "le passage", "prologue",
  "the opening", "the portrait", "the trial", "the transmission", "the passage",
]);

function withoutHeading(block: string, allowOtherHeading = false): string {
  const [first = "", ...rest] = block.split("\n");
  const normalized = first.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/’/g, "'").replace(/^[\s*#>-]+|[\s:.*_-]+$/g, "").toLowerCase();
  return HEADINGS.has(normalized) || (allowOtherHeading && rest.length > 0 && first.length <= 60)
    ? rest.join("\n").trim() : block;
}

/** Historical mirrors appended a second, titled rendering of the same story.
 * Remove it only when the complete text matches, preserving distinct passages. */
export function parchmentParagraphs(text: string): string[] {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
  const comparable = (parts: string[]) => parts.join(" ").replace(/\s+/g, " ").trim();
  let unique = blocks;
  for (let index = 1; index < blocks.length; index++) {
    const first = blocks.slice(0, index).map(block => withoutHeading(block));
    const second = blocks.slice(index).map(block => withoutHeading(block, true));
    if (comparable(first) && comparable(first) === comparable(second)) {
      unique = blocks.slice(0, index);
      break;
    }
  }
  return unique.map(block => withoutHeading(block)).filter(Boolean);
}

export function deliveredParchmentText(text: { parchmentText: string; storyPages: { text: string }[] }): string {
  const source = text.parchmentText.trim() || text.storyPages.map(page => page.text.trim()).filter(Boolean).join("\n\n");
  return parchmentParagraphs(source).join("\n\n");
}
