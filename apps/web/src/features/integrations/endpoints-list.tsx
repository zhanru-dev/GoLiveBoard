"use client";

import { WebhookEndpoint, WebhookSecret } from "@goliveboard/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

import { useMe } from "../shell/me-context";
import { integrationKeys } from "./keys";

export function EndpointsList({
  selected,
  onSelect,
  onSecret,
}: Readonly<{
  selected: string | undefined;
  onSelect: (endpointId: string) => void;
  onSecret: (secret: string) => void;
}>) {
  const { workspaceId } = useMe().activeWorkspace;
  const queryClient = useQueryClient();
  const endpoints = useQuery({
    queryKey: integrationKeys.endpoints(workspaceId),
    queryFn: ({ signal }) =>
      api("/webhook-endpoints", {
        schema: z.array(WebhookEndpoint),
        workspaceId,
        signal,
      }),
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: integrationKeys.endpoints(workspaceId),
    });
  const toggle = useMutation({
    mutationFn: (endpoint: WebhookEndpoint) =>
      api(`/webhook-endpoints/${endpoint.id}`, {
        method: "PATCH",
        body: { active: !endpoint.active },
        ifMatch: endpoint.version,
        schema: WebhookEndpoint,
        workspaceId,
      }),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });
  const rotate = useMutation({
    mutationFn: (endpoint: WebhookEndpoint) =>
      api(`/webhook-endpoints/${endpoint.id}/rotate-secret`, {
        method: "POST",
        schema: WebhookSecret,
        workspaceId,
      }),
    onSuccess: ({ secret }) => {
      onSecret(secret);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (endpoint: WebhookEndpoint) =>
      api(`/webhook-endpoints/${endpoint.id}`, {
        method: "DELETE",
        workspaceId,
      }),
    onSuccess: () => toast.success("Endpoint deleted"),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });

  if (endpoints.isPending) {
    return <p>Loading…</p>;
  }
  if (endpoints.isError) {
    return <p role="alert">{errorMessage(endpoints.error)}</p>;
  }
  if (endpoints.data.length === 0) {
    return <p className="text-muted-foreground">No endpoints yet.</p>;
  }
  return (
    <ul className="grid gap-3">
      {endpoints.data.map((endpoint) => (
        <li
          key={endpoint.id}
          aria-label={endpoint.url}
          className="grid gap-2 rounded-lg border p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm break-all">{endpoint.url}</span>
            <Badge variant={endpoint.active ? "secondary" : "outline"}>
              {endpoint.active ? "Active" : "Paused"}
            </Badge>
          </div>
          {endpoint.description === "" ? null : (
            <p className="text-sm">{endpoint.description}</p>
          )}
          <p className="text-sm text-muted-foreground">
            {endpoint.eventTypes.join(", ")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-pressed={selected === endpoint.id}
              onClick={() => {
                onSelect(endpoint.id);
              }}
            >
              Deliveries
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={toggle.isPending}
              onClick={() => {
                toggle.mutate(endpoint);
              }}
            >
              {endpoint.active ? "Pause" : "Resume"}
            </Button>
            <Confirm
              label="Rotate secret"
              title="Rotate the signing secret?"
              description="Webhooks are signed with the new secret from now on. Update your receiver at once."
              onConfirm={() => {
                rotate.mutate(endpoint);
              }}
            />
            <Confirm
              label="Delete"
              title="Delete this endpoint?"
              description="Its deliveries are deleted with it. This cannot be undone."
              onConfirm={() => {
                remove.mutate(endpoint);
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Confirm({
  label,
  title,
  description,
  onConfirm,
}: Readonly<{
  label: string;
  title: string;
  description: string;
  onConfirm: () => void;
}>) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
