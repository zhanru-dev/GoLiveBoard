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
import { startSilentServer } from "../testing/silent-server.js";
import { createValkeyClient } from "../valkey/valkey.js";
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

    await expect(slots.refresh([[room, "live"]], 10)).resolves.toEqual([]);

    expect(await valkey.zscore(slotsKey(room), "live")).not.toBeNull();
    const ttl = await valkey.pttl(slotsKey(room));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SLOT_STALE_MS);
  });

  it("takes a dropped slot back only under the limit, and names those that could not", async () => {
    const room = `session:${randomUUID()}`;
    const slots = new ConnectionSlots(valkey, config);
    const old = Array.from(
      { length: 10 },
      (_, index) => `old-${String(index)}`,
    );
    for (const connection of old) {
      await slots.claim(room, connection, 10);
    }
    // Valkey forgot them (an outage), and ten new connections came in.
    await valkey.del(slotsKey(room));
    for (let index = 0; index < 10; index += 1) {
      expect(await slots.claim(room, `new-${String(index)}`, 10)).toBe(true);
    }

    const lost = await slots.refresh(
      old.map((connection) => [room, connection] as const),
      10,
    );

    expect(lost).toEqual(old.map((connection) => [room, connection]));
    expect(await valkey.zcard(slotsKey(room))).toBe(10);
  });

  it("reports no lost slot when Valkey cannot answer, and decides as usual once it can", async () => {
    const room = `session:${randomUUID()}`;
    const working = new ConnectionSlots(valkey, config);
    const old = Array.from(
      { length: 10 },
      (_, index) => `old-${String(index)}`,
    );
    for (const connection of old) {
      await working.claim(room, connection, 10);
    }
    await valkey.del(slotsKey(room));
    for (let index = 0; index < 10; index += 1) {
      await working.claim(room, `new-${String(index)}`, 10);
    }
    const silent = await startSilentServer();
    const frozenValkey = createValkeyClient(
      loadTestConfig({ VALKEY_URL: silent.url.replace("http:", "redis:") }),
    );
    try {
      const frozen = new ConnectionSlots(frozenValkey, config);
      const pairs = old.map((connection) => [room, connection] as const);

      // Nothing is known, so nobody is closed.
      await expect(frozen.refresh(pairs, 10)).resolves.toEqual([]);
      // Once Valkey answers, the old connections are found to have lost.
      await expect(working.refresh(pairs, 10)).resolves.toEqual(pairs);
    } finally {
      frozenValkey.disconnect();
      await silent.close();
    }
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
