"use client";

import { EventPage } from "@opspilot/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";

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
import { formatInZone } from "@/lib/time";

import { useMe } from "../shell/me-context";
import { eventKeys } from "./event-keys";
import { EventStatusBadge } from "./event-status";
import type { EventListFilters } from "./event-list-filters";

function listPath(filters: EventListFilters, cursor: string | undefined) {
  const params = new URLSearchParams();
  if (filters.q !== undefined) params.set("q", filters.q);
  if (filters.status !== undefined) params.set("status", filters.status);
  if (filters.from !== undefined) params.set("from", filters.from);
  if (filters.to !== undefined) params.set("to", filters.to);
  if (cursor !== undefined) params.set("cursor", cursor);
  const query = params.toString();
  return query === "" ? "/events" : `/events?${query}`;
}

export function EventsTable({
  filters,
}: Readonly<{ filters: EventListFilters }>) {
  const { workspaceId } = useMe().activeWorkspace;
  const events = useInfiniteQuery({
    queryKey: eventKeys.list(workspaceId, filters),
    queryFn: ({ pageParam, signal }) =>
      api(listPath(filters, pageParam), {
        schema: EventPage,
        workspaceId,
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  if (events.isPending) {
    return <p role="status">Loading events…</p>;
  }
  if (events.isError) {
    return <p role="alert">Could not load the events.</p>;
  }
  const items = events.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    const filtered = Object.keys(filters).length > 0;
    return (
      <p className="text-muted-foreground">
        {filtered
          ? "No events match these filters."
          : "No events yet. Create one to start preparing it."}
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Starts</TableHead>
            <TableHead>Owner</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((event) => (
            <TableRow key={event.id}>
              <TableCell>
                <Link
                  href={`/events/${event.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {event.title}
                </Link>
              </TableCell>
              <TableCell>
                <EventStatusBadge status={event.status} />
              </TableCell>
              <TableCell>
                {formatInZone(event.startsAt, event.timeZone)}
              </TableCell>
              <TableCell>{event.owner?.name ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {events.hasNextPage ? (
        <Button
          variant="outline"
          className="justify-self-center"
          disabled={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
        >
          {events.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
