import { describe, expect, it, vi } from "vitest";

import type { AttendeeSessions } from "../attendees/attendee-sessions.js";
import type { ActorLoader } from "../auth/actor-loader.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { Participants } from "./participants.js";

/**
 * A revocation deletes the attendee's sessions and marks the attendee in
 * one transaction. Read statement by statement, it can be seen half done
 * (a live session for a revoked attendee), and a connection was then told
 * ACCESS_REVOKED instead of SIGNED_OUT, depending on timing.
 */
describe("Participants.authorize", () => {
  function participants() {
    const prisma = {
      event: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const byId = vi.fn().mockResolvedValue(undefined);
    const sessions = { byId } as unknown as AttendeeSessions;
    const actors = {
      loadSession: vi.fn().mockResolvedValue(undefined),
    } as unknown as ActorLoader;
    return { subject: new Participants(prisma, actors, sessions), byId };
  }

  it("reads the attendee session from a snapshot of its own when given no transaction", async () => {
    const { subject, byId } = participants();

    const access = await subject.authorize(
      { attendeeSessionId: "session-1" },
      { id: "event-1" },
      "request-1",
    );

    // No client: AttendeeSessions.byId opens its own repeatable-read
    // transaction, rather than reading through the plain client.
    expect(byId).toHaveBeenCalledWith("session-1", undefined);
    expect(access).toEqual({ ok: false, error: "UNAUTHENTICATED" });
  });

  it("reads it within the caller's transaction when given one", async () => {
    const { subject, byId } = participants();
    const tx = {
      event: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as Prisma.TransactionClient;

    await subject.authorize(
      { attendeeSessionId: "session-1" },
      { id: "event-1" },
      "request-1",
      tx,
    );

    expect(byId).toHaveBeenCalledWith("session-1", tx);
  });
});
