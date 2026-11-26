"use client";

import {
  AuditPage as AuditPageSchema,
  type AuditEntry,
  Member,
} from "@goliveboard/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { teamKeys } from "../team/roles";

const PAGE_SIZE = 50;
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "medium",
});

interface Filters {
  readonly actorId: string;
  readonly action: string;
  /** `datetime-local` values, in the browser's zone. */
  readonly from: string;
  readonly to: string;
}

const NONE: Filters = { actorId: "", action: "", from: "", to: "" };

/** FR-RC-1: who did what and when, for every role. */
export function AuditPage() {
  const { workspaceId } = useMe().activeWorkspace;
  const eventId = useSearchParams().get("eventId") ?? "";
  const [draft, setDraft] = useState<Filters>(NONE);
  const [filters, setFilters] = useState<Filters>(NONE);
  const members = useQuery({
    queryKey: teamKeys.members(workspaceId),
    queryFn: ({ signal }) =>
      api("/workspace/members", {
        schema: z.array(Member),
        workspaceId,
        signal,
      }),
  });
  const entries = useInfiniteQuery({
    queryKey: ["audit", workspaceId, eventId, filters],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      api(`/audit-entries?${search(filters, eventId, pageParam)}`, {
        schema: AuditPageSchema,
        workspaceId,
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });

  const items = entries.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Audit trail</h1>
      {eventId === "" ? null : (
        <p className="text-muted-foreground">For one event only.</p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setFilters(draft);
        }}
        aria-label="Filters"
        className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end"
      >
        <div className="grid gap-2">
          <Label htmlFor="audit-actor">Who</Label>
          <select
            id="audit-actor"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={draft.actorId}
            onChange={(event) => {
              setDraft({ ...draft, actorId: event.target.value });
            }}
          >
            <option value="">Anyone</option>
            {(members.data ?? []).map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="audit-action">Action</Label>
          <Input
            id="audit-action"
            placeholder="event.transitioned"
            value={draft.action}
            onChange={(event) => {
              setDraft({ ...draft, action: event.target.value.trim() });
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="audit-from">From</Label>
          <Input
            id="audit-from"
            type="datetime-local"
            value={draft.from}
            onChange={(event) => {
              setDraft({ ...draft, from: event.target.value });
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="audit-to">Before</Label>
          <Input
            id="audit-to"
            type="datetime-local"
            value={draft.to}
            onChange={(event) => {
              setDraft({ ...draft, to: event.target.value });
            }}
          />
        </div>
        <Button type="submit">Search</Button>
      </form>
      {entries.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(entries.error)}
        </p>
      ) : null}
      {entries.isPending ? <p>Loading…</p> : null}
      {entries.isSuccess && items.length === 0 ? (
        <p className="text-muted-foreground">Nothing matches.</p>
      ) : null}
      {items.length === 0 ? null : (
        <Table scrollLabel="Audit entries">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap">
                  <time dateTime={entry.occurredAt}>
                    {timeFormat.format(new Date(entry.occurredAt))}
                  </time>
                </TableCell>
                <TableCell>{actorName(entry)}</TableCell>
                <TableCell className="font-mono text-sm whitespace-normal">
                  {entry.action}
                </TableCell>
                <TableCell className="max-w-md text-sm break-words whitespace-normal">
                  {change(entry)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {entries.hasNextPage ? (
        <Button
          variant="outline"
          className="w-fit"
          disabled={entries.isFetchingNextPage}
          onClick={() => void entries.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function search(filters: Filters, eventId: string, cursor: string): string {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (eventId !== "") query.set("eventId", eventId);
  if (filters.actorId !== "") query.set("actorId", filters.actorId);
  if (filters.action !== "") query.set("action", filters.action);
  if (filters.from !== "")
    query.set("from", new Date(filters.from).toISOString());
  if (filters.to !== "") query.set("to", new Date(filters.to).toISOString());
  if (cursor !== "") query.set("cursor", cursor);
  return query.toString();
}

function actorName(entry: AuditEntry): string {
  switch (entry.actor.kind) {
    case "SYSTEM":
      return "GoLiveBoard";
    case "ATTENDEE":
      return "An attendee";
    case "USER":
      return entry.actor.name ?? "A former member";
  }
}

/** "status: Draft → Configuring", or the values as they were recorded. */
function change(entry: AuditEntry): string {
  const before = record(entry.before);
  const after = record(entry.after);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .map((key) => {
      const was = key in before ? show(before[key]) : undefined;
      const now = key in after ? show(after[key]) : undefined;
      if (was === undefined) return `${key}: ${now ?? ""}`;
      if (now === undefined) return `${key}: ${was} (removed)`;
      return `${key}: ${was} → ${now}`;
    })
    .join("; ");
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function show(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
