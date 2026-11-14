import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { PasswordHasher } from "../auth/password-hasher.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Clock } from "../shared/clock.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import { DemoSeeder } from "./demo-seeder.js";

const EVENT_ID = "0193f2a4-0000-7b2a-9d1f-3e5c7a9b1d2f";

function seederWith(storage: Pick<ObjectStorage, "listKeys" | "remove">) {
  return new DemoSeeder(
    {} as PrismaClient,
    {} as Clock,
    {} as PasswordHasher,
    storage as ObjectStorage,
    { warn: vi.fn() } as unknown as PinoLogger,
  );
}

describe("DemoSeeder.purgeEventFiles", () => {
  it("deletes everything stored for the events, slates and uploads alike", async () => {
    const remove = vi.fn(() => Promise.resolve());
    const seeder = seederWith({
      listKeys: (prefix: string) => Promise.resolve([`${prefix}a`]),
      remove,
    });

    await seeder.purgeEventFiles([EVENT_ID]);

    expect(remove.mock.calls).toEqual([
      [`events/${EVENT_ID}/a`],
      [`uploads/events/${EVENT_ID}/a`],
    ]);
  });

  it("fails when storage fails, so the job is retried", async () => {
    const seeder = seederWith({
      listKeys: () => Promise.reject(new Error("Storage is down")),
      remove: vi.fn(),
    });

    await expect(seeder.purgeEventFiles([EVENT_ID])).rejects.toThrow(
      "Storage is down",
    );
  });
});
