"use client";

import type { Poll, PollList, RealtimeChannel } from "@goliveboard/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RealtimeConnection } from "./realtime-connection";

/**
 * Keeps the newest snapshot of a poll: a higher version wins (polls have no
 * replay, docs/design/polls.md). The viewer's own answer, which only their
 * own answers carry, survives a snapshot without it.
 */
export function mergePoll(
  current: ReadonlyMap<string, Poll>,
  incoming: Poll,
): ReadonlyMap<string, Poll> {
  const before = current.get(incoming.id);
  if (before !== undefined) {
    const older = before.version > incoming.version;
    const sameWithoutAnswer =
      before.version === incoming.version && incoming.myOptionId === undefined;
    if (older || sameWithoutAnswer) {
      return current;
    }
  }
  return new Map(current).set(incoming.id, {
    ...incoming,
    myOptionId: incoming.myOptionId ?? before?.myOptionId,
  });
}

/** Newest first. */
export function orderPolls(polls: Iterable<Poll>): Poll[] {
  return [...polls].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}

/**
 * An event's polls, live (FR-RN-8): loaded over HTTP, again whenever the
 * connection joins a channel (so after a reconnect) or the event's status
 * changes (completing or cancelling it closes its open poll, which is not
 * announced), and updated by every `poll.updated` the server sends.
 */
export function usePolls(
  connection: RealtimeConnection | undefined,
  joined: ReadonlySet<RealtimeChannel>,
  /** The event's status as the page knows it (staff or public terms). */
  status: string,
  list: () => Promise<PollList>,
) {
  const [polls, setPolls] = useState<ReadonlyMap<string, Poll>>(new Map());
  const [reloads, setReloads] = useState(0);
  const listRef = useRef(list);

  const merge = useCallback((poll: Poll) => {
    setPolls((current) => mergePoll(current, poll));
  }, []);

  useEffect(() => {
    let cancelled = false;
    listRef
      .current()
      .then((loaded) => {
        if (!cancelled) {
          setPolls((current) => loaded.items.reduce(mergePoll, current));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [joined, status, reloads]);

  /** Loads the list again, as the server has it. */
  const reload = useCallback(() => {
    setReloads((count) => count + 1);
  }, []);

  useEffect(() => connection?.onPoll(merge), [connection, merge]);

  /** Forgets a poll the API deleted (drafts only). */
  const forget = useCallback((pollId: string) => {
    setPolls((current) => {
      const next = new Map(current);
      next.delete(pollId);
      return next;
    });
  }, []);

  const ordered = useMemo(() => orderPolls(polls.values()), [polls]);
  return { polls: ordered, merge, forget, reload };
}
