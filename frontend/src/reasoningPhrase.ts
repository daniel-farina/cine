/** Last few words for the live status label while reasoning streams in. */
export function lastPhrase(text: string, maxWords = 8): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return words.slice(-maxWords).join(" ");
}