"use client";

import type {
  ChatMessage,
  ChatPage,
  ChatSendAck,
  EventStatusChanged,
  PublicEventStatus,
  Question,
  QuestionList,
  QuestionsEvent,
  RealtimeChannel,
} from "@opspilot/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type ConnectionState,
  RealtimeConnection,
} from "./realtime-connection";
import { realtimeFailureReporter } from "@/lib/browser-telemetry";

/**
 * The page's connection to one event. It lives as long as the component
 * that holds it; `status` follows `event.status`.
 */
export function useLiveConnection(
  slug: string,
  options: {
    readonly initialStatus?: PublicEventStatus;
    readonly refreshSession?: () => Promise<boolean>;
  } = {},
) {
  const [connection, setConnection] = useState<RealtimeConnection>();
  const [state, setState] = useState<ConnectionState>("connecting");
  const [status, setStatus] = useState(options.initialStatus);
  const [joined, setJoined] = useState<ReadonlySet<RealtimeChannel>>(new Set());
  const refreshSession = useRef(options.refreshSession);

  useEffect(() => {
    const created = new RealtimeConnection({
      slug,
      onState: setState,
      // One page view: this connection lives as long as the watch page.
      onFailure: realtimeFailureReporter(),
      onStatus: (event: EventStatusChanged) => {
        setStatus(event.status);
      },
      onJoined: (channel) => {
        setJoined((current) => new Set(current).add(channel));
      },
      refreshSession: refreshSession.current,
    });
    created.connect();
    setConnection(created);
    return () => {
      created.close();
    };
  }, [slug]);

  return { connection, state, status, joined };
}

/** What chat needs from the API, for attendees or for staff. */
export interface ChatSource {
  readonly history: () => Promise<ChatPage>;
}

/** A message this browser sent that the server has not stored yet. */
export interface PendingMessage {
  readonly clientMessageId: string;
  readonly body: string;
  readonly failed: boolean;
}

/**
 * Live chat (FR-RN-2): the messages in order, each once, and sending with
 * retries that never duplicate (the same client message ID every time).
 */
export function useChat(
  connection: RealtimeConnection | undefined,
  slug: string,
  source: ChatSource,
) {
  const [messages, setMessages] = useState<ReadonlyMap<string, ChatMessage>>(
    new Map(),
  );
  const [pending, setPending] = useState<readonly PendingMessage[]>([]);
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const sourceRef = useRef(source);

  const upsert = useCallback((message: ChatMessage) => {
    setMessages((current) => new Map(current).set(message.id, message));
  }, []);

  useEffect(() => {
    if (connection === undefined) {
      return;
    }
    void connection.follow({
      channel: "CHAT",
      loadSnapshot: async () => {
        const page = await sourceRef.current.history();
        setMessages(new Map(page.items.map((item) => [item.id, item])));
        return page.latestSequence;
      },
      apply: (event) => {
        upsert(event.message);
      },
    });
  }, [connection, upsert]);

  const deliver = useCallback(
    async (message: PendingMessage) => {
      if (connection === undefined) {
        return;
      }
      let ack: ChatSendAck | undefined;
      try {
        ack = await connection.request<ChatSendAck>("chat.send", {
          slug,
          clientMessageId: message.clientMessageId,
          body: message.body,
        });
      } catch {
        ack = undefined;
      }
      if (ack?.ok === true) {
        upsert(ack.message);
        setPending((current) =>
          current.filter(
            ({ clientMessageId }) =>
              clientMessageId !== message.clientMessageId,
          ),
        );
        return;
      }
      setPending((current) =>
        current.map((each) =>
          each.clientMessageId === message.clientMessageId
            ? { ...each, failed: true }
            : each,
        ),
      );
    },
    [connection, slug, upsert],
  );

  // After a reconnect, what was not acknowledged goes again: the server
  // returns the stored message if the first try did arrive.
  useEffect(
    () =>
      connection?.onConnect(() => {
        for (const message of pendingRef.current) {
          void deliver(message);
        }
      }),
    [connection, deliver],
  );

  const send = useCallback(
    (body: string) => {
      const message = {
        clientMessageId: crypto.randomUUID(),
        body,
        failed: false,
      };
      setPending((current) => [...current, message]);
      void deliver(message);
    },
    [deliver],
  );

  const retry = useCallback(
    (clientMessageId: string) => {
      const message = pendingRef.current.find(
        (each) => each.clientMessageId === clientMessageId,
      );
      if (message !== undefined) {
        setPending((current) =>
          current.map((each) =>
            each.clientMessageId === clientMessageId
              ? { ...each, failed: false }
              : each,
          ),
        );
        void deliver(message);
      }
    },
    [deliver],
  );

  const ordered = useMemo(
    () => [...messages.values()].sort((a, b) => a.sequence - b.sequence),
    [messages],
  );
  return { messages: ordered, pending, send, retry };
}

/** What Q&A needs from the API, for attendees or for staff. */
export interface QuestionsSource {
  readonly list: () => Promise<QuestionList>;
}

/**
 * Applies one Q&A event: a question replaces the stored one but keeps what
 * only this viewer knows (mine, votedByMe); WITHDRAWN removes it.
 */
export function applyQuestionsEvent(
  current: ReadonlyMap<string, Question>,
  event: QuestionsEvent,
): Map<string, Question> {
  const next = new Map(current);
  if (event.kind === "WITHDRAWN") {
    if (event.questionId !== undefined) {
      next.delete(event.questionId);
    }
    return next;
  }
  const before = current.get(event.question.id);
  next.set(event.question.id, {
    ...event.question,
    mine: before?.mine ?? false,
    votedByMe: before?.votedByMe ?? false,
  });
  return next;
}

/**
 * Pinned first (by slot), then by votes, then oldest first; questions
 * merged into others last.
 */
export function orderQuestions(questions: Iterable<Question>): Question[] {
  return [...questions].sort(
    (a, b) =>
      Number(a.mergedIntoId !== null) - Number(b.mergedIntoId !== null) ||
      (a.pinSlot ?? 4) - (b.pinSlot ?? 4) ||
      b.voteCount - a.voteCount ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/** Q&A (FR-RN-4, FR-RN-5), as this viewer may see it. */
export function useQuestions(
  connection: RealtimeConnection | undefined,
  source: QuestionsSource,
) {
  const [questions, setQuestions] = useState<ReadonlyMap<string, Question>>(
    new Map(),
  );
  const sourceRef = useRef(source);

  useEffect(() => {
    if (connection === undefined) {
      return;
    }
    void connection.follow({
      channel: "QUESTIONS",
      loadSnapshot: async () => {
        const list = await sourceRef.current.list();
        setQuestions(new Map(list.items.map((item) => [item.id, item])));
        return list.latestSequence;
      },
      apply: (event) => {
        setQuestions((current) => applyQuestionsEvent(current, event));
      },
    });
  }, [connection]);

  /** Takes a question the API returned to this viewer (asked, voted). */
  const merge = useCallback((question: Question) => {
    setQuestions((current) => {
      const before = current.get(question.id);
      return new Map(current).set(question.id, {
        ...before,
        ...question,
        mine: question.mine ?? before?.mine ?? false,
        votedByMe: question.votedByMe ?? before?.votedByMe ?? false,
      });
    });
  }, []);

  const ordered = useMemo(
    () => orderQuestions(questions.values()),
    [questions],
  );
  return { questions: ordered, merge };
}
