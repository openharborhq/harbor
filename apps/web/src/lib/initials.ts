/**
 * "Kai Pradel" → KP, "Kai" → KA. First letters of the first and last word, so a full name
 * doesn't read as the first two letters of a first name.
 *
 * Lives here, not beside the sidebar: a server component can't import a plain function out of a
 * "use client" module — it receives a client reference, not the function.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}
