import { z } from "zod";

/** FR-ST-3: holding slates are at most 5 MB. */
export const HOLDING_SLATE_MAX_BYTES = 5 * 1024 * 1024;

/** FR-ST-3: JPEG, PNG or WebP. */
export const ImageContentType = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export type ImageContentType = z.infer<typeof ImageContentType>;

/**
 * Body of `POST /events/:id/assets/holding-slate`. The type and size are
 * signed into the upload URL, so storage refuses any other file.
 */
export const CreateHoldingSlateUploadRequest = z.object({
  contentType: ImageContentType,
  sizeBytes: z.int().min(1).max(HOLDING_SLATE_MAX_BYTES, {
    error: "The image must be 5 MB or smaller",
  }),
});
export type CreateHoldingSlateUploadRequest = z.infer<
  typeof CreateHoldingSlateUploadRequest
>;

/**
 * Where and how the browser uploads: `PUT` the file to `url` with exactly
 * these headers before `expiresAt`, then call `POST /assets/:id/complete`.
 */
export const AssetUpload = z.object({
  assetId: z.uuid(),
  url: z.url(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});
export type AssetUpload = z.infer<typeof AssetUpload>;

export const AssetStatus = z.enum(["PENDING", "READY", "REJECTED"]);
export type AssetStatus = z.infer<typeof AssetStatus>;

export const Asset = z.object({
  id: z.uuid(),
  kind: z.enum(["HOLDING_SLATE"]),
  status: AssetStatus,
  contentType: ImageContentType,
  sizeBytes: z.int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Asset = z.infer<typeof Asset>;

/** Body of `GET /events/:id/assets/holding-slate`: the current slate. */
export const HoldingSlate = Asset.extend({
  /** A short-lived link to show the image; fetch a new one when it expires. */
  downloadUrl: z.url(),
  downloadUrlExpiresAt: z.iso.datetime(),
});
export type HoldingSlate = z.infer<typeof HoldingSlate>;
