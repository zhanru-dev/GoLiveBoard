import { z } from "zod";

/** docs/04, section 2: `limit` defaults to 25 and may not exceed 100. */
export const PAGE_LIMIT_DEFAULT = 25;
export const PAGE_LIMIT_MAX = 100;
/** Cursors are opaque to clients; the bound only stops absurd inputs. */
const CURSOR_MAX_LENGTH = 500;

/** `?limit=…&cursor=…`, shared by every cursor-paginated list. */
export const PageQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGE_LIMIT_MAX)
    .default(PAGE_LIMIT_DEFAULT),
  cursor: z.string().min(1).max(CURSOR_MAX_LENGTH).optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

/**
 * A page of a cursor-paginated list. `nextCursor` is `null` on the last page;
 * otherwise sending it back as `cursor` returns the page after this one.
 */
export function pageOf<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
