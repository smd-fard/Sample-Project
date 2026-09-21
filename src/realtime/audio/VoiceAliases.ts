/** OpenAI voice names mapped to Inworld library voice ids. */
export const OPENAI_VOICE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  alloy: 'Ashley',
  ash: 'Dennis',
  ballad: 'Craig',
  coral: 'Olivia',
  echo: 'Mark',
  sage: 'Elizabeth',
  shimmer: 'Sarah',
  verse: 'Timothy',
  marin: 'Hades',
  cedar: 'Alex',
});

/**
 * Resolves a requested voice: an OpenAI alias (case-insensitive) maps to its
 * Inworld id, any other non-empty value passes through trimmed as an Inworld
 * id, and empty/missing input yields `fallback`.
 */
export function resolveVoice(name: string | undefined | null, fallback: string): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  const alias = OPENAI_VOICE_ALIASES[trimmed.toLowerCase()];
  return alias ?? trimmed;
}
