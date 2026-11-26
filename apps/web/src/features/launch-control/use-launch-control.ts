"use client";

import { EventDetail } from "@goliveboard/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

import { eventKeys } from "../events/event-keys";
import { useMe } from "../shell/me-context";

/**
 * Stream checks and incidents happen in the background, and readiness
 * depends on the clock (a check counts for 5 minutes), so these refresh on
 * their own.
 */
export const LIVE_REFRESH_MS = 10_000;

/**
 * What every Launch Control section needs: the event, who may change it,
 * and a way to refresh everything after a change (the readiness score
 * depends on all sections, so they are refreshed together).
 */
export function useLaunchControl(eventId: string) {
  const me = useMe();
  const { workspaceId, role } = me.activeWorkspace;
  const queryClient = useQueryClient();
  const event = useQuery({
    queryKey: eventKeys.detail(workspaceId, eventId),
    queryFn: ({ signal }) =>
      api(`/events/${eventId}`, { schema: EventDetail, workspaceId, signal }),
  });
  const archived = event.data?.status === "ARCHIVED";
  return {
    workspaceId,
    event,
    /** Managers and Owners change events; nobody changes an archived one. */
    canEdit: role !== "ANALYST" && !archived,
    refresh: () =>
      queryClient.invalidateQueries({
        queryKey: eventKeys.detail(workspaceId, eventId),
      }),
  };
}

export type LaunchControl = ReturnType<typeof useLaunchControl>;
