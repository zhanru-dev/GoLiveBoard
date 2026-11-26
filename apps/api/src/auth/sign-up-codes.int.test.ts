import type { NestExpressApplication } from "@nestjs/platform-express";
import { ProblemDetails } from "@goliveboard/contracts";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ApiClient,
  TEST_PASSWORD,
  uniqueEmail,
} from "../testing/api-client.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";
import { digestSignUpCode } from "./sign-up-codes.js";

const CODE = "kestrel-lantern-orbit-4412";

describe("sign-up with invite codes in force (FR-WS-1)", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let sql: Pool;
  let client: ApiClient;
  const mailer = new CapturingMailer();

  beforeAll(async () => {
    database = await createTestDatabase();
    sql = new Pool({ connectionString: database.url });
    app = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        SIGN_UP_CODES: `acme:${digestSignUpCode(CODE).toString("hex")}`,
      },
      mailer,
    });
    client = new ApiClient(app);
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await database.drop();
  });

  async function users(email: string) {
    const result = await sql.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM users WHERE email = $1",
      [email],
    );
    return result.rows[0]?.n;
  }

  it.each([
    ["without a code", undefined],
    ["with a wrong code", "kestrel-lantern-orbit-4413"],
  ])("refuses sign-up %s, and creates and emails nobody", async (_, code) => {
    const email = uniqueEmail();

    const response = await client.signUp(email, TEST_PASSWORD, "Ada", code);

    expect(response.status).toBe(403);
    expect(ProblemDetails.parse(response.body)).toMatchObject({
      code: "SIGN_UP_CODE_INVALID",
      title: "That invite code is not valid",
    });
    expect(await users(email)).toBe(0);
    expect(mailer.to(email)).toEqual([]);
  });

  it("creates the account with a valid code", async () => {
    const email = uniqueEmail();

    const response = await client.signUp(
      email,
      TEST_PASSWORD,
      "Ada",
      ` ${CODE} `,
    );

    expect(response.status).toBe(202);
    expect(await users(email)).toBe(1);
  });

  it("still answers a registered address like a new one, given a valid code", async () => {
    const email = uniqueEmail();
    await client.signUp(email, TEST_PASSWORD, "Ada", CODE);

    const again = await client.signUp(email, TEST_PASSWORD, "Ada", CODE);

    expect(again.status).toBe(202);
    expect(await users(email)).toBe(1);
  });
});
