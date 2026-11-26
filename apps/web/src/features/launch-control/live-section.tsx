"use client";

import {
  ChatMessage,
  ChatPage,
  type EventDetail,
  type EventStatus,
  Question,
  QuestionList,
  type QuestionStatus,
} from "@goliveboard/contracts";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError, refreshSession } from "@/lib/api";

import { ChatPanel } from "../live/chat-panel";
import { useChat, useLiveConnection, useQuestions } from "../live/use-live";
import { Section } from "./section";
import { TriagePanel } from "./triage-panel";
import type { LaunchControl } from "./use-launch-control";

/** The statuses in which an event has chat and Q&A to show. */
const READABLE: readonly EventStatus[] = [
  "CONFIGURING",
  "READY",
  "LIVE",
  "COMPLETED",
];
const OPEN: readonly EventStatus[] = ["CONFIGURING", "READY", "LIVE"];

const STATUS_LABELS: Record<QuestionStatus, string> = {
  PENDING: "Waiting for approval",
  PUBLISHED: "Published",
  HIDDEN: "Hidden",
  ANSWERED: "Answered",
};

const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? (error.problem.detail ?? error.problem.title)
    : "Something went wrong.";

/**
 * Chat and Q&A moderation (FR-RN-3, FR-RN-5), and whether questions wait for
 * approval (FR-RN-4). Managers and Owners moderate; Analysts watch.
 */
export function LiveSection({
  control,
  event,
}: Readonly<{ control: LaunchControl; event: EventDetail }>) {
  return (
    <Section id="live-interaction" title="Chat and Q&A">
      <PreModeration control={control} event={event} />
      {READABLE.includes(event.status) ? (
        <LiveRoom control={control} event={event} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Chat and questions open once the event is being configured.
        </p>
      )}
    </Section>
  );
}

function PreModeration({
  control,
  event,
}: Readonly<{ control: LaunchControl; event: EventDetail }>) {
  // Shown at once, put back if the change is refused.
  const [checked, setChecked] = useState(event.questionsPreModerated);
  const [stored, setStored] = useState(event.questionsPreModerated);
  if (stored !== event.questionsPreModerated) {
    setStored(event.questionsPreModerated);
    setChecked(event.questionsPreModerated);
  }
  const change = useMutation({
    mutationFn: (questionsPreModerated: boolean) =>
      api(`/events/${event.id}`, {
        method: "PATCH",
        body: { questionsPreModerated },
        ifMatch: event.version,
        workspaceId: control.workspaceId,
      }),
    onError: (error) => {
      setChecked(event.questionsPreModerated);
      toast.error(errorMessage(error));
    },
    onSettled: control.refresh,
  });
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={!control.canEdit || change.isPending}
        onChange={(input) => {
          setChecked(input.target.checked);
          change.mutate(input.target.checked);
        }}
      />
      Questions wait for approval before attendees see them
    </label>
  );
}

function LiveRoom({
  control,
  event,
}: Readonly<{ control: LaunchControl; event: EventDetail }>) {
  const { workspaceId, canEdit } = control;
  const { connection, state } = useLiveConnection(event.slug, {
    refreshSession,
  });
  const sources = useMemo(
    () => ({
      chat: {
        history: () =>
          api(`/events/${event.id}/chat/messages`, {
            schema: ChatPage,
            workspaceId,
          }),
      },
      questions: {
        list: () =>
          api(`/events/${event.id}/questions`, {
            schema: QuestionList,
            workspaceId,
          }),
      },
    }),
    [event.id, workspaceId],
  );
  const chat = useChat(connection, event.slug, sources.chat);
  const qa = useQuestions(connection, sources.questions);
  const [deleting, setDeleting] = useState<ChatMessage>();

  const moderate = useMutation({
    mutationFn: ({
      question,
      change,
    }: {
      question: Question;
      change: { status?: QuestionStatus; pinned?: boolean };
    }) =>
      api(`/questions/${question.id}`, {
        method: "PATCH",
        body: change,
        ifMatch: question.version,
        schema: Question,
        workspaceId,
      }),
    onSuccess: qa.merge,
    onError: (error) => {
      toast.error(
        error instanceof ApiError && error.problem.status === 412
          ? "Someone changed this question meanwhile; it now shows their change."
          : errorMessage(error),
      );
    },
  });
  const remove = useMutation({
    mutationFn: (message: ChatMessage) =>
      api(`/events/${event.id}/chat/messages/${message.id}`, {
        method: "DELETE",
        schema: ChatMessage,
        workspaceId,
      }),
    onSuccess: () => toast.success("Message deleted"),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const open = OPEN.includes(event.status);
  return (
    <div className="grid gap-6">
      {state === "reconnecting" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reconnecting…
        </p>
      ) : null}
      {canEdit && open ? (
        <TriagePanel
          eventId={event.id}
          workspaceId={workspaceId}
          questions={qa.questions}
        />
      ) : null}
      <div className="grid gap-3">
        <h3 className="font-medium">Questions</h3>
        {qa.questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No questions yet.</p>
        ) : (
          <ol className="grid gap-2" aria-label="Questions to moderate">
            {qa.questions.map((question) => (
              <li
                key={question.id}
                className="grid gap-2 rounded-lg border p-3 text-sm"
              >
                <p className="whitespace-pre-wrap">{question.body}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {STATUS_LABELS[question.status]}
                  </Badge>
                  {question.pinSlot === null ? null : (
                    <Badge variant="outline">Pinned</Badge>
                  )}
                  {question.mergedIntoId === null ? null : (
                    <Badge variant="outline">
                      Merged into “
                      {qa.questions.find(
                        ({ id }) => id === question.mergedIntoId,
                      )?.body ?? "another question"}
                      ”
                    </Badge>
                  )}
                  <span className="text-muted-foreground">
                    {question.author.name} · {question.voteCount}{" "}
                    {question.voteCount === 1 ? "vote" : "votes"}
                  </span>
                </div>
                {canEdit ? (
                  <div className="flex flex-wrap gap-1">
                    {actionsFor(question).map((action) => (
                      <Button
                        key={action.label}
                        variant="outline"
                        size="sm"
                        disabled={moderate.isPending}
                        aria-label={`${action.label}: ${question.body}`}
                        onClick={() => {
                          moderate.mutate({ question, change: action.change });
                        }}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
      <ChatPanel
        messages={chat.messages}
        pending={chat.pending}
        onSend={chat.send}
        onRetry={chat.retry}
        onDelete={canEdit ? setDeleting : undefined}
        disabledReason={chatClosedReason(canEdit, open)}
      />
      <AlertDialog
        open={deleting !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setDeleting(undefined);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleting?.author.name ?? "this"}&apos;s message?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its text disappears for everyone; a note that a moderator removed
              it stays in its place. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting !== undefined) {
                  remove.mutate(deleting);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Why staff cannot write in the chat now; undefined when they can. */
function chatClosedReason(canEdit: boolean, open: boolean) {
  if (!canEdit) {
    return "Analysts follow the chat; Managers and Owners write in it.";
  }
  return open ? undefined : "The event has ended.";
}

interface Action {
  readonly label: string;
  readonly change: { status?: QuestionStatus; pinned?: boolean };
}

/** What a moderator can do with a question, as the API allows it. */
export function actionsFor(question: Question): Action[] {
  // Merged into another (AI triage): nothing more to do with it here.
  if (question.mergedIntoId !== null) {
    return [];
  }
  const pin: Action[] =
    question.pinSlot === null
      ? [{ label: "Pin", change: { pinned: true } }]
      : [{ label: "Unpin", change: { pinned: false } }];
  switch (question.status) {
    case "PENDING":
      return [
        { label: "Approve", change: { status: "PUBLISHED" } },
        { label: "Hide", change: { status: "HIDDEN" } },
      ];
    case "PUBLISHED":
      return [
        { label: "Mark answered", change: { status: "ANSWERED" } },
        ...pin,
        { label: "Hide", change: { status: "HIDDEN" } },
      ];
    case "ANSWERED":
      return [{ label: "Reopen", change: { status: "PUBLISHED" } }, ...pin];
    case "HIDDEN":
      return [{ label: "Publish", change: { status: "PUBLISHED" } }];
    default:
      return question.status satisfies never;
  }
}
