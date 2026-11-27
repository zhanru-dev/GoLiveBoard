"use client";

import { WorkspaceOverview } from "@goliveboard/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";

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
import { api, apiText } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { saveFile } from "@/lib/save-file";

import { useMe } from "../shell/me-context";
import { Figure, share } from "./figures";
import { MonthBars } from "./month-bars";

interface Span {
  readonly from: string;
  readonly to: string;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** "27 Nov 2026" for "2026-11-27" or an instant on that day (UTC). */
function formatDay(value: string): string {
  return dayFormat.format(
    new Date(value.length === 10 ? `${value}T00:00:00Z` : value),
  );
}

/**
 * Every completed event over a span, and how they compare (FR-RC-4).
 * Without a span, the API covers the last twelve months.
 */
export function OverviewPage() {
  const { workspaceId } = useMe().activeWorkspace;
  const [span, setSpan] = useState<Span>();
  const [draft, setDraft] = useState<Partial<Span>>({});
  const fromId = useId();
  const toId = useId();
  const query = span === undefined ? "" : `?from=${span.from}&to=${span.to}`;
  const overview = useQuery({
    queryKey: ["workspace-overview", workspaceId, query],
    queryFn: ({ signal }) =>
      api(`/reports/overview${query}`, {
        schema: WorkspaceOverview,
        workspaceId,
        signal,
      }),
  });
  const download = useMutation({
    mutationFn: async ({ from, to }: Span) => {
      const csv = await apiText(`/reports/overview.csv?from=${from}&to=${to}`, {
        workspaceId,
      });
      saveFile(`overview-${from}-to-${to}.csv`, csv);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  // The inputs show the span on screen until the user changes them.
  const from = draft.from ?? overview.data?.from ?? "";
  const to = draft.to ?? overview.data?.to ?? "";
  const valid = from !== "" && to !== "" && from <= to;

  return (
    <div className="grid gap-8">
      <header className="grid max-w-3xl gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">
          Every completed event over a span, and how they compare. Each
          event&apos;s own report has its audience minute by minute.
        </p>
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(submitted) => {
          submitted.preventDefault();
          if (valid) {
            setSpan({ from, to });
          }
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={fromId}>From</Label>
          <Input
            id={fromId}
            type="date"
            value={from}
            onChange={(change) => {
              setDraft((current) => ({
                ...current,
                from: change.target.value,
              }));
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={toId}>To</Label>
          <Input
            id={toId}
            type="date"
            value={to}
            onChange={(change) => {
              setDraft((current) => ({ ...current, to: change.target.value }));
            }}
          />
        </div>
        <Button type="submit" variant="outline" disabled={!valid}>
          Show
        </Button>
      </form>

      {overview.isPending ? <p>Loading…</p> : null}
      {overview.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(overview.error)}
        </p>
      ) : null}
      {overview.data === undefined ? null : (
        <Overview
          overview={overview.data}
          downloading={download.isPending}
          onDownload={() => {
            download.mutate(overview.data);
          }}
        />
      )}
    </div>
  );
}

function Overview({
  overview,
  downloading,
  onDownload,
}: Readonly<{
  overview: WorkspaceOverview;
  downloading: boolean;
  onDownload: () => void;
}>) {
  const { totals } = overview;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-medium">
          {formatDay(overview.from)} – {formatDay(overview.to)}: {totals.events}{" "}
          completed {totals.events === 1 ? "event" : "events"}
        </p>
        <Button
          variant="outline"
          className="ml-auto"
          disabled={downloading}
          onClick={onDownload}
        >
          Download CSV
        </Button>
      </div>
      {totals.events === 0 ? (
        <p className="text-muted-foreground">
          No event completed in this span. An event counts here once it has gone
          live and been marked completed;{" "}
          <Link href="/events" className="underline underline-offset-4">
            see your events
          </Link>
          .
        </p>
      ) : (
        <>
          <section aria-labelledby="totals-heading" className="grid gap-2">
            <h2 id="totals-heading" className="text-lg font-semibold">
              In total
            </h2>
            <dl className="grid gap-2 sm:grid-cols-3">
              <Figure term="Registered" value={totals.registered} />
              <Figure
                term="Attended"
                value={totals.attended}
                share={share(totals.attended, totals.registered)}
              />
              <Figure
                term="Highest peak audience"
                value={totals.peakAudience}
              />
              <Figure term="Average peak audience" value={totals.averagePeak} />
              <Figure
                term="Questions answered"
                value={totals.questionsAnswered}
                share={share(totals.questionsAnswered, totals.questionsAsked)}
              />
              <Figure term="Incidents" value={totals.incidents} />
            </dl>
          </section>
          <section aria-labelledby="months-heading" className="grid gap-2">
            <h2 id="months-heading" className="text-lg font-semibold">
              By month
            </h2>
            <MonthBars
              label="Attendees per month"
              unit="attendees"
              points={overview.months.map(({ month, attended }) => ({
                month,
                value: attended,
              }))}
            />
          </section>
          <section aria-labelledby="events-heading" className="grid gap-2">
            <h2 id="events-heading" className="text-lg font-semibold">
              Events
            </h2>
            <Table scrollLabel="Completed events">
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Registered</TableHead>
                  <TableHead className="text-right">Attended</TableHead>
                  <TableHead className="text-right">Peak</TableHead>
                  <TableHead className="text-right">Questions</TableHead>
                  <TableHead className="text-right">Incidents</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <Link
                        href={`/events/${event.id}/report`}
                        className="font-medium text-primary hover:underline"
                      >
                        {event.title}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDay(event.startsAt)}</TableCell>
                    <TableCell className="text-right">
                      {event.registered}
                    </TableCell>
                    <TableCell className="text-right">
                      {event.attended}
                    </TableCell>
                    <TableCell className="text-right">
                      {event.peakAudience}
                    </TableCell>
                    <TableCell className="text-right">
                      {event.questionsAsked}
                    </TableCell>
                    <TableCell className="text-right">
                      {event.incidents}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </>
      )}
    </>
  );
}
