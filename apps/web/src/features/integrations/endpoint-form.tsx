"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CreateWebhookEndpointRequest,
  WebhookEndpointCreated,
  WebhookEventType,
} from "@opspilot/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";

import { useMe } from "../shell/me-context";
import { EVENT_TYPE_LABELS, integrationKeys } from "./keys";

type Values = z.input<typeof CreateWebhookEndpointRequest>;

/** Adds an endpoint; the caller shows the secret it comes back with. */
export function EndpointForm({
  onCreated,
}: Readonly<{ onCreated: (secret: string) => void }>) {
  const { workspaceId } = useMe().activeWorkspace;
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values, unknown, CreateWebhookEndpointRequest>({
    resolver: zodResolver(CreateWebhookEndpointRequest),
    defaultValues: { url: "", eventTypes: [], description: "" },
  });
  const create = useMutation({
    mutationFn: (values: CreateWebhookEndpointRequest) =>
      api("/webhook-endpoints", {
        method: "POST",
        body: values,
        schema: WebhookEndpointCreated,
        workspaceId,
      }),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      const created = await create.mutateAsync(values);
      reset();
      onCreated(created.secret);
      await queryClient.invalidateQueries({
        queryKey: integrationKeys.endpoints(workspaceId),
      });
    } catch (error) {
      setFormError(
        applyApiError(error, setError, ["url", "eventTypes", "description"]),
      );
    }
  });

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="grid gap-4"
    >
      <FormAlert message={formError} />
      <FormField
        label="Receiver URL"
        type="url"
        placeholder="https://example.com/webhooks/opspilot"
        hint="https only, on the public internet."
        error={errors.url?.message}
        {...register("url")}
      />
      <fieldset
        className="grid gap-2"
        aria-describedby={
          errors.eventTypes === undefined ? undefined : "event-types-error"
        }
      >
        <legend className="mb-1 text-sm font-medium">Send these events</legend>
        {WebhookEventType.options.map((type) => (
          <label key={type} className="flex items-center gap-2 text-sm">
            <input type="checkbox" value={type} {...register("eventTypes")} />
            {EVENT_TYPE_LABELS[type]}{" "}
            <span className="font-mono text-muted-foreground">({type})</span>
          </label>
        ))}
        {errors.eventTypes === undefined ? null : (
          <p id="event-types-error" className="text-sm text-destructive">
            Choose at least one event.
          </p>
        )}
      </fieldset>
      <FormField
        label="Description (optional)"
        error={errors.description?.message}
        {...register("description")}
      />
      <Button type="submit" disabled={isSubmitting} className="w-fit">
        Add endpoint
      </Button>
    </form>
  );
}
