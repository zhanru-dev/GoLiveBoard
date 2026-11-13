/** Long enough to read in a URL, short enough to share. */
const SLUG_TITLE_MAX_LENGTH = 60;
const FALLBACK_SLUG_TITLE = "event";

/**
 * Turns a title into the readable part of a public URL:
 * "Café Launch: 2026!" → "cafe-launch-2026".
 *
 * Accents are removed, anything that is not a letter or digit becomes a
 * hyphen, and the result is cut at a word boundary. A title with no usable
 * characters (for example only emoji) becomes "event".
 */
export function slugifyTitle(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (words.length <= SLUG_TITLE_MAX_LENGTH) {
    return words === "" ? FALLBACK_SLUG_TITLE : words;
  }
  const cut = words.slice(0, SLUG_TITLE_MAX_LENGTH + 1);
  const boundary = cut.lastIndexOf("-");
  return boundary > 0 ? cut.slice(0, boundary) : cut.slice(0, -1);
}

/**
 * The event's public slug: the readable title plus a random suffix, so two
 * events with the same title get different URLs and slugs cannot be guessed
 * from titles alone (docs/03 section 6).
 *
 * @param title - the event title at creation; later edits keep the slug, so
 * shared links keep working
 * @param suffix - random lowercase letters and digits from the caller
 */
export function eventSlug(title: string, suffix: string): string {
  return `${slugifyTitle(title)}-${suffix}`;
}
