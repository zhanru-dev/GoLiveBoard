import { z } from "zod";

import { pageOf } from "./pagination.js";

const STREAM_URL_MAX_LENGTH = 2_048;

/**
 * FR-ST-1: an `https` URL without credentials. Whether its host resolves to
 * a public address is checked by the API, and again on every fetch, because
 * DNS answers can change.
 */
export const StreamUrl = z
  .url({ protocol: /^https$/, error: "Enter an https:// URL" })
  .max(STREAM_URL_MAX_LENGTH)
  // "https://user:secret@host/…": an "@" before the path means credentials.
  // (Checked on the text: contracts also run where no URL class is typed.)
  .refine((value) => !/^https:\/\/[^/?#]*@/i.test(value), {
    error: "The URL must not contain a user name or password",
  });

/** Body of `PUT /events/:id/stream`. */
export const SetStreamRequest = z.object({ url: StreamUrl });
export type SetStreamRequest = z.infer<typeof SetStreamRequest>;

/** One fetch of the stream manifest (FR-ST-2). */
export const StreamCheck = z.object({
  id: z.uuid(),
  url: z.string(),
  checkedAt: z.iso.datetime(),
  ok: z.boolean(),
  /** Null when no HTTP response arrived. */
  httpStatus: z.int().nullable(),
  latencyMs: z.int().min(0),
  /** Why the check failed, e.g. "Timed out after 5 seconds". */
  failure: z.string().nullable(),
});
export type StreamCheck = z.infer<typeof StreamCheck>;

export const StreamCheckPage = pageOf(StreamCheck);
export type StreamCheckPage = z.infer<typeof StreamCheckPage>;

export const IncidentKind = z.enum(["STREAM_UNREACHABLE"]);
export type IncidentKind = z.infer<typeof IncidentKind>;

/** Opened by two failed checks in a row, resolved by two successes. */
export const Incident = z.object({
  id: z.uuid(),
  kind: IncidentKind,
  openedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type Incident = z.infer<typeof Incident>;
