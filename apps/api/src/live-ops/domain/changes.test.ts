import type { Incident } from "@opspilot/contracts";
import { describe, expect, it } from "vitest";

import { changesBetween, type Now, toldAfter } from "./changes.js";

const incident = (
  id: string,
  openedAt: string,
  resolvedAt: string | null = null,
): Incident => ({
  id,
  kind: "STREAM_UNREACHABLE",
  openedAt,
  resolvedAt,
});

const A = "0193f2a4-0000-7000-8000-00000000000a";
const B = "0193f2a4-0000-7000-8000-00000000000b";

const base: Now = {
  status: "LIVE",
  checkedAt: "2026-12-01T17:00:00.000Z",
  incidents: [],
};

describe("changesBetween", () => {
  it("sends nothing when nothing changed", () => {
    expect(changesBetween(toldAfter(base), base)).toEqual([]);
  });

  it("sends a new check's result", () => {
    expect(
      changesBetween(toldAfter(base), {
        ...base,
        checkedAt: "2026-12-01T17:00:30.000Z",
      }),
    ).toEqual([{ kind: "STREAM_STATUS" }]);
  });

  it("sends nothing for a stream never checked", () => {
    const never = { ...base, checkedAt: null };
    expect(changesBetween(toldAfter(never), never)).toEqual([]);
  });

  it("sends a whole snapshot when the status changed, and nothing else", () => {
    expect(
      changesBetween(toldAfter(base), {
        ...base,
        status: "COMPLETED",
        checkedAt: "2026-12-01T17:00:30.000Z",
        incidents: [incident(A, "2026-12-01T17:00:10.000Z")],
      }),
    ).toEqual([{ kind: "SNAPSHOT" }]);
  });

  it("sends incidents opened and resolved, oldest first, each once", () => {
    const told = toldAfter({
      ...base,
      incidents: [incident(A, "2026-12-01T16:50:00.000Z")],
    });
    const now = {
      ...base,
      incidents: [
        incident(B, "2026-12-01T16:59:00.000Z", "2026-12-01T16:59:40.000Z"),
        incident(A, "2026-12-01T16:50:00.000Z", "2026-12-01T16:58:00.000Z"),
      ],
    };

    const changes = changesBetween(told, now);

    expect(
      changes.map((change) => [
        change.kind,
        "incident" in change ? change.incident.id : "",
      ]),
    ).toEqual([
      ["INCIDENT_RESOLVED", A],
      ["INCIDENT_OPENED", B],
      ["INCIDENT_RESOLVED", B],
    ]);
    expect(changesBetween(toldAfter(now), now)).toEqual([]);
  });
});
