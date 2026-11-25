"use client";

import { WebhookDelivery, WebhookDeliveryPage } from "@opspilot/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

import { useMe } from "../shell/me-context";
import { integrationKeys } from "./keys";

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** The latest deliveries to one endpoint, with how each attempt went. */
export function Deliveries({ endpointId }: Readonly<{ endpointId: string }>) {
  const { workspaceId } = useMe().activeWorkspace;
  const queryClient = useQueryClient();
  const deliveries = useQuery({
    queryKey: integrationKeys.deliveries(workspaceId, endpointId),
    queryFn: ({ signal }) =>
      api(`/webhook-deliveries?endpointId=${endpointId}&limit=50`, {
        schema: WebhookDeliveryPage,
        workspaceId,
        signal,
      }),
  });
  const redeliver = useMutation({
    mutationFn: (deliveryId: string) =>
      api(`/webhook-deliveries/${deliveryId}/redeliver`, {
        method: "POST",
        schema: WebhookDelivery,
        workspaceId,
      }),
    onSuccess: () => toast.success("It will be sent again within seconds."),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: integrationKeys.deliveries(workspaceId, endpointId),
      }),
  });

  if (deliveries.isPending) {
    return <p>Loading…</p>;
  }
  if (deliveries.isError) {
    return <p role="alert">{errorMessage(deliveries.error)}</p>;
  }
  if (deliveries.data.items.length === 0) {
    return <p className="text-muted-foreground">Nothing sent yet.</p>;
  }
  return (
    <Table scrollLabel="Deliveries">
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last attempt</TableHead>
          <TableHead>Next attempt</TableHead>
          <TableHead className="sr-only">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deliveries.data.items.map((delivery) => {
          const last = delivery.history.at(-1);
          return (
            <TableRow key={delivery.id}>
              <TableCell className="font-mono text-sm">
                {delivery.eventType}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    delivery.status === "FAILED" ? "destructive" : "secondary"
                  }
                >
                  {delivery.status.charAt(0) +
                    delivery.status.slice(1).toLowerCase()}
                </Badge>{" "}
                <span className="text-sm text-muted-foreground">
                  {delivery.attempts}{" "}
                  {delivery.attempts === 1 ? "attempt" : "attempts"}
                </span>
              </TableCell>
              <TableCell className="text-sm whitespace-normal">
                {last === undefined
                  ? "—"
                  : `${timeFormat.format(new Date(last.attemptedAt))}: ${
                      last.error ?? `answered ${String(last.statusCode)}`
                    }`}
              </TableCell>
              <TableCell className="text-sm">
                {delivery.nextAttemptAt === null
                  ? "—"
                  : timeFormat.format(new Date(delivery.nextAttemptAt))}
              </TableCell>
              <TableCell>
                {delivery.status === "PENDING" ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={redeliver.isPending}
                    onClick={() => {
                      redeliver.mutate(delivery.id);
                    }}
                  >
                    Send again
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
