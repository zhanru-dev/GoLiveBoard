import type { NestExpressApplication } from "@nestjs/platform-express";
import { ProblemDetails } from "@goliveboard/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ApiClient, uniqueEmail } from "../testing/api-client.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createTestApp } from "../testing/test-app.js";

describe("rate limits", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let ipCounter = 0;
  /** Each test signs in from its own address, so per-address limits stay separate. */
  const clientFromNewAddress = () => {
    ipCounter += 1;
    return new ApiClient(app, `203.0.113.${String(ipCounter)}`);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        TRUST_PROXY_HOPS: "1",
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  it("blocks an account after 10 failed sign-ins, even with the right password", async () => {
    const api = clientFromNewAddress();
    const owner = await api.newOwner();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await api.signIn(owner.email, "wrong password")).status).toBe(
        401,
      );
    }

    const blocked = await api.signIn(owner.email);

    expect(blocked.status).toBe(429);
    expect(ProblemDetails.parse(blocked.body)).toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 900,
    });
  });

  it("holds the limit against a burst of concurrent guesses", async () => {
    const api = clientFromNewAddress();
    const owner = await api.newOwner();

    // Every attempt takes its slot before the password is checked, so the
    // burst cannot all pass the check before any failure is counted.
    const responses = await Promise.all(
      Array.from({ length: 24 }, () =>
        Promise.resolve(api.signIn(owner.email, "wrong password")),
      ),
    );

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(10);
    expect(statuses.filter((status) => status === 429)).toHaveLength(14);
    expect((await api.signIn(owner.email)).status).toBe(429);
  });

  // Twelve password hashes: about 2 s alone, more beside a busy suite.
  it(
    "does not count successful sign-ins against an address",
    { timeout: 15_000 },
    async () => {
      // Twelve colleagues, more than the limit, sign up elsewhere and then
      // all sign in from the same office address.
      const owners = [];
      for (let index = 0; index < 12; index += 1) {
        owners.push(await clientFromNewAddress().newOwner());
      }
      const office = clientFromNewAddress();

      const statuses = [];
      for (const owner of owners) {
        statuses.push((await office.signIn(owner.email)).status);
      }

      expect(statuses.every((status) => status === 204)).toBe(true);
    },
  );

  it("clears an account's failures after a successful sign-in", async () => {
    const api = clientFromNewAddress();
    const owner = await api.newOwner();
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await api.signIn(owner.email, "wrong password");
    }
    expect((await api.signIn(owner.email)).status).toBe(204);

    expect((await api.signIn(owner.email, "wrong password")).status).toBe(401);
  });

  it("blocks an address after 10 failed sign-ins across different accounts", async () => {
    const attacker = clientFromNewAddress();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await attacker.signIn(uniqueEmail("target"), "guess");
    }

    const blocked = await attacker.signIn(uniqueEmail("target"), "guess");
    const someoneElse = await clientFromNewAddress().signIn(
      uniqueEmail("target"),
      "guess",
    );

    expect(blocked.status).toBe(429);
    expect(someoneElse.status).toBe(401);
  });
});

describe("rate limits while Valkey is unreachable", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    database = await createTestDatabase();
    // The default test configuration points Valkey at a closed port.
    app = await createTestApp({ env: { DATABASE_URL: database.url } });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  it("still lets people sign in (fail open)", async () => {
    const api = new ApiClient(app);
    const email = uniqueEmail();
    await api.signUp(email);

    expect((await api.signIn(email)).status).toBe(204);
  });
});
