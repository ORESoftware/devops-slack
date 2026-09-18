export function truncateText(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false };
  const suffix = "\n\n_[response truncated by slack-ores-integrations]_";
  return {
    text: `${text.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`,
    truncated: true
  };
}

export function chunkText(text, maxLength = 3500) {
  if (!Number.isInteger(maxLength) || maxLength < 100) {
    throw new Error("maxLength must be an integer of at least 100");
  }

  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1);
    const paragraphBreak = window.lastIndexOf("\n\n");
    const lineBreak = window.lastIndexOf("\n");
    const spaceBreak = window.lastIndexOf(" ");
    const splitAt = Math.max(paragraphBreak, lineBreak, spaceBreak, Math.floor(maxLength * 0.6));

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}
