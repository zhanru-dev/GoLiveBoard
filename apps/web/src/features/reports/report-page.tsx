"use client";

import { EventReport } from "@opspilot/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, ApiError, apiText } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatInZone, timeInZone } from "@/lib/time";

import { MinuteChart } from "../charts/minute-chart";
import { useMe } from "../shell/me-context";

/** FR-RC-3: the report of a completed event, for every role. */
export function ReportPage({ eventId }: Readonly<{ eventId: string }>) {
  const { workspaceId } = useMe().activeWorkspace;
  const report = useQuery({
    queryKey: ["report", workspaceId, eventId],
    queryFn: ({ signal }) =>
      api(`/events/${eventId}/report`, {
        schema: EventReport,
        workspaceId,
        signal,
      }),
    retry: false,
  });
  const download = useMutation({
    mutationFn: async (slug: string) => {
      const csv = await apiText(`/events/${eventId}/report.csv`, {
        workspaceId,
      });
      saveFile(`report-${slug}.csv`, csv);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  return (
    <div className="grid gap-8">
      <Link
        href={`/events/${eventId}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Launch Control
      </Link>
      {report.data === undefined ? (
        <h1 className="text-2xl font-semibold tracking-tight">Report</h1>
      ) : null}
      {report.isPending ? <p>Loading…</p> : null}
      {report.isError ? <NoReport error={report.error} /> : null}
      {report.data === undefined ? null : (
        <Report
          report={report.data}
          downloading={download.isPending}
          onDownload={() => {
            download.mutate(report.data.event.slug);
          }}
        />
      )}
    </div>
  );
}

function NoReport({ error }: Readonly<{ error: Error }>) {
  const notYet =
    error instanceof ApiError && error.problem.code === "REPORT_NOT_AVAILABLE";
  return (
    <Alert variant={notYet ? "default" : "destructive"}>
      <AlertTitle>
        {notYet ? "No report yet" : "The report could not be loaded"}
      </AlertTitle>
      <AlertDescription>
        {notYet
          ? "An event has a report once it has completed."
          : errorMessage(error)}
      </AlertDescription>
    </Alert>
  );
}

function Report({
  report,
  downloading,
  onDownload,
}: Readonly<{
  report: EventReport;
  downloading: boolean;
  onDownload: () => void;
}>) {
  const { event, funnel, audience, questions, chat, incidents } = report;
  const zone = event.timeZone;
  return (
    <>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Report: {event.title}
          </h1>
          <Button
            variant="outline"
            className="ml-auto"
            disabled={downloading}
            onClick={onDownload}
          >
            Download CSV
          </Button>
        </div>
        <p className="text-muted-foreground">
          {formatInZone(event.startsAt, zone)} –{" "}
          {formatInZone(event.endsAt, zone)}
        </p>
      </header>
      <section aria-labelledby="funnel-heading" className="grid gap-2">
        <h2 id="funnel-heading" className="text-lg font-semibold">
          Registration
        </h2>
        <dl className="grid gap-2 sm:grid-cols-3">
          <Figure term="Registered" value={funnel.registered} />
          <Figure
            term="Confirmed their address"
            value={funnel.verified}
            share={share(funnel.verified, funnel.registered)}
          />
          <Figure
            term="Attended"
            value={funnel.attended}
            share={share(funnel.attended, funnel.registered)}
          />
        </dl>
      </section>
      <section aria-labelledby="audience-heading" className="grid gap-2">
        <h2 id="audience-heading" className="text-lg font-semibold">
          Audience
        </h2>
        <dl className="grid gap-2 sm:grid-cols-3">
          <Figure term="Peak" value={audience.peak} />
          <Figure term="Average" value={audience.average} />
        </dl>
        <MinuteChart
          label="Viewers per minute, with incidents shaded"
          unit="viewers"
          timeZone={zone}
          points={audience.series.map((point) => ({
            minute: point.minute,
            value: point.viewers,
            marked: point.incident,
          }))}
        />
      </section>
      <section aria-labelledby="interaction-heading" className="grid gap-2">
        <h2 id="interaction-heading" className="text-lg font-semibold">
          Interaction
        </h2>
        <dl className="grid gap-2 sm:grid-cols-3">
          <Figure term="Questions asked" value={questions.asked} />
          <Figure
            term="Questions answered"
            value={questions.answered}
            share={share(questions.answered, questions.asked)}
          />
          <Figure term="Chat messages" value={chat.messages} />
        </dl>
      </section>
      <section aria-labelledby="incidents-heading" className="grid gap-2">
        <h2 id="incidents-heading" className="text-lg font-semibold">
          Incidents
        </h2>
        {incidents.length === 0 ? (
          <p className="text-muted-foreground">None.</p>
        ) : (
          <ul className="grid gap-1">
            {incidents.map((incident) => (
              <li key={incident.id}>
                Stream unreachable from {timeInZone(incident.openedAt, zone)}{" "}
                {incident.resolvedAt === null
                  ? "until the end"
                  : `to ${timeInZone(incident.resolvedAt, zone)}`}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-sm text-muted-foreground">
        Audience figures as of {formatInZone(report.generatedAt, zone)}.
      </p>
    </>
  );
}

function Figure({
  term,
  value,
  share: part,
}: Readonly<{ term: string; value: number; share?: string }>) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="text-2xl font-semibold">
        {value}
        {part === undefined ? null : (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {part}
          </span>
        )}
      </dd>
    </div>
  );
}

/** "(80%)", or nothing of zero. */
function share(part: number, whole: number): string | undefined {
  return whole === 0
    ? undefined
    : `(${String(Math.round((part / whole) * 100))}%)`;
}

/** Hands the text to the browser as a file to save. */
function saveFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
