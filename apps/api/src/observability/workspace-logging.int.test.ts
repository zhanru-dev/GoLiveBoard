import { Controller, Get } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiClient } from "../testing/api-client.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp, LogCapture } from "../testing/test-app.js";

/** A signed-in route that logs, as services do while handling a request. */
@Controller("test-only")
class TestOnlyController {
  constructor(
    @InjectPinoLogger("TestOnlyController")
    private readonly logger: PinoLogger,
  ) {}

  @Get("work")
  work(): { ok: true } {
    this.logger.info("Doing the work");
    return { ok: true };
  }
}

describe("log lines name the workspace (docs/02, section 7.9)", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let api: ApiClient;
  const logs = new LogCapture();

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      env: { DATABASE_URL: database.url },
      controllers: [TestOnlyController],
      mailer: new CapturingMailer(),
      logs,
    });
    api = new ApiClient(app);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  /** The log lines of one request, by the ID the response carried. */
  async function linesFor(send: Promise<{ headers: Record<string, string> }>) {
    const response = await send;
    const id = response.headers["x-request-id"] ?? "";
    await expect
      .poll(() => logs.forRequest(id).some(({ res }) => res !== undefined))
      .toBe(true);
    return logs.forRequest(id) as (Record<string, unknown> & {
      msg?: string;
    })[];
  }

  it("names the actor's workspace on the request's lines and on what the code logs", async () => {
    const session = await api.newOwner();
    const { activeWorkspace } = await api.me(session);

    const lines = await linesFor(api.get(session, "/test-only/work"));

    const workLine = lines.find(({ msg }) => msg === "Doing the work");
    const summary = lines.find(({ msg }) => msg === "request completed");
    expect(workLine?.workspaceId).toBe(activeWorkspace.workspaceId);
    expect(summary?.workspaceId).toBe(activeWorkspace.workspaceId);
  });

  it("names no workspace for a request without a session", async () => {
    const lines = await linesFor(
      api.post("/auth/sign-in", {
        email: "nobody@example.com",
        password: "wrong password at all",
      }),
    );

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toHaveProperty("workspaceId");
    }
  });
});
