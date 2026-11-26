"use client";

import type { LiveOps } from "@goliveboard/contracts";
import { useCallback, useEffect, useReducer, useState } from "react";

import { refreshSession } from "@/lib/api";

import { applyMessage, type StreamMessage } from "./live-ops-state";

/** The stream's message names (docs/04 section 5). */
const EVENTS = [
  "snapshot",
  "stream.status",
  "audience.updated",
  "rates.updated",
  "incident.opened",
  "incident.resolved",
] as const;

/** Refused openings in a row before the page stops trying on its own. */
const MAX_REOPENS = 3;
const REOPEN_AFTER_MS = 2_000;

export type Connection = "CONNECTING" | "LIVE" | "RECONNECTING" | "LOST";

/**
 * The operations room over server-sent events. The browser reconnects by
 * itself (sending `Last-Event-ID`) while the API answers; when it refuses
 * the stream (a 401 once the access token has expired, say), the session
 * is refreshed and the stream opened again, a few times at most.
 */
export function useLiveOps(eventId: string) {
  const [room, dispatch] = useReducer(applyMessage, undefined);
  const [connection, setConnection] = useState<Connection>("CONNECTING");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let refused = 0;
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const open = () => {
      source = new EventSource(`/api/v1/events/${eventId}/live-ops/stream`, {
        withCredentials: true,
      });
      for (const event of EVENTS) {
        source.addEventListener(event, (message: MessageEvent<string>) => {
          let data: unknown;
          try {
            data = JSON.parse(message.data);
          } catch {
            return;
          }
          dispatch({ event, data } satisfies StreamMessage);
        });
      }
      source.addEventListener("open", () => {
        refused = 0;
        setConnection("LIVE");
      });
      source.addEventListener("error", () => {
        if (source?.readyState !== EventSource.CLOSED) {
          setConnection("RECONNECTING");
          return;
        }
        // Refused: no answer the browser retries by itself.
        source.close();
        refused += 1;
        if (refused > MAX_REOPENS) {
          setConnection("LOST");
          return;
        }
        setConnection("RECONNECTING");
        void refreshSession().then((signedIn) => {
          if (stopped) {
            return;
          }
          if (!signedIn) {
            setConnection("LOST");
            return;
          }
          timer = setTimeout(open, REOPEN_AFTER_MS);
        });
      });
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [eventId, attempt]);

  const retry = useCallback(() => {
    setConnection("CONNECTING");
    setAttempt((value) => value + 1);
  }, []);

  return { room: room satisfies LiveOps | undefined, connection, retry };
}
