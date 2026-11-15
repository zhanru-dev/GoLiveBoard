import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";

import { loadTestConfig } from "../testing/config.js";
import {
  ConnectionSlots,
  SLOT_REFRESH_MS,
  SLOT_STALE_MS,
} from "./connection-slots.js";

describe("ConnectionSlots", () => {
  let valkey: Redis;
  const config = loadTestConfig({ VALKEY_URL: inject("valkeyUrl") });

  beforeAll(() => {
    valkey = new Redis(inject("valkeyUrl"));
  });

  afterAll(async () => {
    await valkey.quit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const slotsKey = (room: string) =>
    `${config.realtime.channelPrefix}:realtime:slots:${room}`;

  it("times slots by Valkey's clock, so an instance's drifting clock frees nobody's", async () => {
    const room = `session:${randomUUID()}`;
    const steady = new ConnectionSlots(valkey, config);
    for (let tab = 0; tab < 10; tab += 1) {
      expect(await steady.claim(room, `steady-${String(tab)}`, 10)).toBe(true);
    }
    // Another instance whose clock runs two leases ahead.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + SLOT_STALE_MS * 2);
    const ahead = new ConnectionSlots(valkey, config);

    expect(await ahead.claim(room, "ahead", 10)).toBe(false);
    expect(await valkey.zcard(slotsKey(room))).toBe(10);
  });

  it("puts a live connection's slot back when it was dropped, and lets the key expire", async () => {
    const room = `session:${randomUUID()}`;
    const slots = new ConnectionSlots(valkey, config);
    await slots.claim(room, "live", 10);
    // Dropped, as after a Valkey outage longer than the lease.
    await valkey.zrem(slotsKey(room), "live");

    await slots.refresh([[room, "live"]]);

    expect(await valkey.zscore(slotsKey(room), "live")).not.toBeNull();
    const ttl = await valkey.pttl(slotsKey(room));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SLOT_STALE_MS);
  });

  it("sets an expiry on a session's slots when it first claims one", async () => {
    const room = `session:${randomUUID()}`;
    await new ConnectionSlots(valkey, config).claim(room, "first", 10);

    const ttl = await valkey.pttl(slotsKey(room));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SLOT_STALE_MS);
  });

  it("refreshes well within the lease", () => {
    expect(SLOT_REFRESH_MS * 2).toBeLessThan(SLOT_STALE_MS);
  });
});
