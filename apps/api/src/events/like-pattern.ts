/**
 * Prisma passes `contains` to ILIKE as `%value%` without escaping, so a search
 * for "100%" would also match "1000". Backslash is PostgreSQL's default LIKE
 * escape character.
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
