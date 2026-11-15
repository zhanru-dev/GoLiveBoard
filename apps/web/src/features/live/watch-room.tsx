"use client";

import type {
  ChatPage,
  Question,
  QuestionList,
  WatchInfo,
} from "@opspilot/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { requestPublic } from "@/lib/public-api";

import { PublicNotice } from "../public/public-ui";
import { ChatPanel } from "./chat-panel";
import { Player } from "./player";
import { QuestionsPanel } from "./questions-panel";
import type { ConnectionState } from "./realtime-connection";
import { useChat, useLiveConnection, useQuestions } from "./use-live";

/** FR-RN-7: attendees say they are watching every 30 seconds. */
export const HEARTBEAT_MS = 30_000;

async function load<T>(path: string): Promise<T> {
  const response = await requestPublic<T>("GET", path);
  if (!response.ok) {
    throw new Error(response.message);
  }
  return response.body;
}

const STATE_NOTES: Partial<Record<ConnectionState, string>> = {
  reconnecting: "Reconnecting… Messages sent meanwhile go out once it is back.",
  "signed-out": "You have been signed out of this event.",
  refused: "You no longer have access to this event.",
};

/** The attendee's watch page (FR-RN-1): stream or slate, chat and Q&A. */
export function WatchRoom({ info }: Readonly<{ info: WatchInfo }>) {
  const { slug } = info;
  const router = useRouter();
  const { connection, state, status } = useLiveConnection(slug, {
    initialStatus: info.status,
  });
  const current = status ?? info.status;
  const sources = useMemo(
    () => ({
      chat: {
        history: () => load<ChatPage>(`/public/events/${slug}/chat/messages`),
      },
      questions: {
        list: () => load<QuestionList>(`/public/events/${slug}/questions`),
      },
    }),
    [slug],
  );
  const chat = useChat(connection, slug, sources.chat);
  const qa = useQuestions(connection, sources.questions);
  const [questionError, setQuestionError] = useState<string>();

  // The stream's address comes with the page: reload it when the event
  // goes live, without the attendee doing anything.
  useEffect(() => {
    if (status !== undefined && status !== info.status) {
      router.refresh();
    }
  }, [status, info.status, router]);

  useEffect(() => {
    if (connection === undefined || current !== "LIVE") {
      return;
    }
    const beat = () => {
      if (document.visibilityState === "visible") {
        connection.request("watch.heartbeat", { slug }).catch(() => undefined);
      }
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
    };
  }, [connection, current, slug]);

  async function ask(body: string): Promise<boolean> {
    setQuestionError(undefined);
    const response = await requestPublic<Question>(
      "POST",
      `/public/events/${slug}/questions`,
      { body: { body }, headers: { "Idempotency-Key": crypto.randomUUID() } },
    );
    if (!response.ok) {
      setQuestionError(response.message);
      return false;
    }
    qa.merge(response.body);
    return true;
  }

  async function vote(question: Question) {
    setQuestionError(undefined);
    const response = await requestPublic<Question>(
      question.votedByMe === true ? "DELETE" : "PUT",
      `/public/events/${slug}/questions/${question.id}/vote`,
    );
    if (response.ok) {
      qa.merge(response.body);
    } else {
      setQuestionError(response.message);
    }
  }

  const open = current === "UPCOMING" || current === "LIVE";
  const closedReason = open ? undefined : "The event has ended.";
  const note = STATE_NOTES[state];
  return (
    <div className="grid gap-6">
      {note === undefined ? null : (
        <PublicNotice role={state === "reconnecting" ? "status" : "alert"}>
          <p>{note}</p>
          {state === "reconnecting" ? null : (
            <p>
              <a href={`/e/${slug}`}>Back to the event page</a>
            </p>
          )}
        </PublicNotice>
      )}
      <Player
        status={current}
        streamUrl={current === "LIVE" ? info.streamUrl : null}
        slate={info.slate}
        title={info.title}
      />
      <div className="grid gap-8 md:grid-cols-2">
        <ChatPanel
          messages={chat.messages}
          pending={chat.pending}
          onSend={chat.send}
          onRetry={chat.retry}
          disabledReason={closedReason}
        />
        <QuestionsPanel
          questions={qa.questions}
          onAsk={ask}
          onVote={(question) => void vote(question)}
          disabledReason={closedReason}
          error={questionError}
        />
      </div>
    </div>
  );
}
