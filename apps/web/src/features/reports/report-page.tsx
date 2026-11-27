"use client";

import { EventReport } from "@goliveboard/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect } from "react";

import { EventTabs } from "../events/event-tabs";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, ApiError, apiText } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { saveFile } from "@/lib/save-file";
import { formatInZone, timeInZone } from "@/lib/time";

import { MinuteChart } from "../charts/minute-chart";
import { Figure, share } from "./figures";
import { remember } from "../onboarding/visits";
import { useMe } from "../shell/me-context";

/** FR-RC-3: the report of a completed event, for every role. */
export function ReportPage({ eventId }: Readonly<{ eventId: string }>) {
  const { workspaceId } = useMe().activeWorkspace;
  // For the demo guide: this browser has opened a report.
  useEffect(() => {
    remember(workspaceId, "report");
  }, [workspaceId]);
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
      {report.data === undefined ? (
        <Link
          href={`/events/${eventId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Launch Control
        </Link>
      ) : (
        <EventTabs event={report.data.event} current="report" />
      )}
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
      {report.polls.length === 0 ? null : (
        <section aria-labelledby="polls-heading" className="grid gap-3">
          <h2 id="polls-heading" className="text-lg font-semibold">
            Polls
          </h2>
          {report.polls.map((poll) => (
            <div key={poll.id} className="grid gap-1.5 rounded-lg border p-4">
              <h3 className="font-medium">{poll.question}</h3>
              <ul className="grid gap-1 text-sm">
                {poll.options.map((option) => (
                  <li key={option.label} className="flex gap-2">
                    <span className="grow">{option.label}</span>
                    <span className="figures">
                      {option.votes} {share(option.votes, poll.totalVotes)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                {poll.totalVotes} {poll.totalVotes === 1 ? "answer" : "answers"}
              </p>
            </div>
          ))}
        </section>
      )}
      <p className="text-sm text-muted-foreground">
        Audience figures as of {formatInZone(report.generatedAt, zone)}.
      </p>
    </>
  );
}
