"use client";

import {
  Asset,
  AssetUpload,
  HOLDING_SLATE_MAX_BYTES,
  HoldingSlate,
  ImageContentType,
} from "@opspilot/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ChangeEvent, useId, useState } from "react";
import { toast } from "sonner";

import { FormAlert } from "@/components/form-alert";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

import { eventKeys } from "../events/event-keys";
import { Section } from "./section";
import type { LaunchControl } from "./use-launch-control";

/**
 * Uploads a file the way FR-ST-3 requires: ask the API for a presigned URL,
 * send the file straight to object storage, then ask the API to verify it.
 */
async function uploadSlate(
  control: LaunchControl,
  eventId: string,
  file: File,
): Promise<Asset> {
  const contentType = ImageContentType.parse(file.type);
  const target = await api(`/events/${eventId}/assets/holding-slate`, {
    method: "POST",
    body: { contentType, sizeBytes: file.size },
    schema: AssetUpload,
    workspaceId: control.workspaceId,
  });
  const stored = await fetch(target.url, {
    method: target.method,
    headers: target.headers,
    body: file,
  });
  if (!stored.ok) {
    throw new Error("The upload to storage failed.");
  }
  return api(`/assets/${target.assetId}/complete`, {
    method: "POST",
    schema: Asset,
    workspaceId: control.workspaceId,
  });
}

/** Problems the browser can spot before uploading anything. */
function checkFile(file: File): string | undefined {
  if (!ImageContentType.safeParse(file.type).success) {
    return "Choose a JPEG, PNG or WebP image.";
  }
  if (file.size > HOLDING_SLATE_MAX_BYTES) {
    return "The image must be 5 MB or smaller.";
  }
  return undefined;
}

export function HoldingSlateSection({
  control,
  eventId,
}: Readonly<{ control: LaunchControl; eventId: string }>) {
  const inputId = useId();
  const [error, setError] = useState("");
  const slate = useQuery({
    queryKey: eventKeys.holdingSlate(control.workspaceId, eventId),
    queryFn: async ({ signal }) => {
      try {
        return await api(`/events/${eventId}/assets/holding-slate`, {
          schema: HoldingSlate,
          workspaceId: control.workspaceId,
          signal,
        });
      } catch (failure) {
        if (failure instanceof ApiError && failure.problem.status === 404) {
          return null;
        }
        throw failure;
      }
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => uploadSlate(control, eventId, file),
    onSuccess: () => toast.success("Holding slate uploaded"),
    onError: (failure) => {
      setError(
        failure instanceof ApiError ? errorMessage(failure) : failure.message,
      );
    },
    onSettled: () => control.refresh(),
  });

  function choose(event: ChangeEvent<HTMLInputElement>) {
    setError("");
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) {
      return;
    }
    const problem = checkFile(file);
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    upload.mutate(file);
  }

  return (
    <Section id="holding-slate" title="Holding slate">
      <p className="text-sm text-muted-foreground">
        Shown to attendees until the event goes live. JPEG, PNG or WebP, up to 5
        MB.
      </p>
      {slate.isSuccess && slate.data !== null ? (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived presigned URL that Next's image optimiser must not cache
        <img
          src={slate.data.downloadUrl}
          alt="Current holding slate"
          className="max-h-60 w-auto rounded-lg border"
        />
      ) : null}
      {slate.isSuccess && slate.data === null ? (
        <p className="text-muted-foreground">No holding slate yet.</p>
      ) : null}
      <FormAlert message={error} />
      {control.canEdit ? (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>
            {slate.data === null ? "Upload an image" : "Replace the image"}
          </Label>
          <input
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={upload.isPending}
            onChange={choose}
            // The browser's file control is wide; on a narrow screen it
            // shrinks with the page instead (WCAG 1.4.10).
            className="w-full min-w-0 text-sm"
          />
          {upload.isPending ? <p role="status">Uploading…</p> : null}
        </div>
      ) : null}
    </Section>
  );
}
