import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AnthropicTriageModel } from "./anthropic-triage-model.js";
import { TRIAGE_SYSTEM_PROMPT } from "./domain/prompt.js";
import { TriageModelError } from "./triage-model.js";

interface Seen {
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Record<string, unknown>;
}

const OUTPUT = {
  groups: [{ representative: "q1", questions: ["q1", "q2"], reason: "Same" }],
  answer_order: ["q1"],
};

/** The Messages API's answer, as the fake server sends it. */
function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: JSON.stringify(OUTPUT) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1200, output_tokens: 80 },
    ...overrides,
  };
}

/**
 * A stand-in for the Anthropic API on 127.0.0.1: it records each request
 * and answers with the next canned reply.
 */
describe("AnthropicTriageModel", () => {
  let server: Server;
  let baseURL: string;
  const seen: Seen[] = [];
  let reply: { status: number; body: unknown; delayMs?: number } = {
    status: 200,
    body: message(),
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      request.on("end", () => {
        seen.push({
          path: request.url ?? "",
          headers: request.headers,
          body: JSON.parse(raw) as Record<string, unknown>,
        });
        const send = () => {
          response.writeHead(reply.status, {
            "content-type": "application/json",
          });
          response.end(JSON.stringify(reply.body));
        };
        if (reply.delayMs === undefined) {
          send();
        } else {
          setTimeout(send, reply.delayMs).unref();
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    baseURL = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  });

  const model = () =>
    new AnthropicTriageModel("claude-opus-5-5", "test-key", baseURL);
  const questions =
    "<questions>\nq1: How much?\nq2: What does it cost?\n</questions>";
  const triage = () => model().triage(questions, new AbortController().signal);

  it("asks for structured output at low effort, with the API's fallback, sending only the questions", async () => {
    reply = { status: 200, body: message() };
    seen.length = 0;

    const answer = await triage();

    expect(answer).toEqual({
      output: OUTPUT,
      model: "claude-opus-5-5",
      usage: { inputTokens: 1200, outputTokens: 80 },
      attempts: [
        { model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 80 },
      ],
    });
    const [request] = seen;
    expect(request?.path).toBe("/v1/messages");
    expect(request?.headers["anthropic-beta"]).toContain(
      "server-side-fallback-2026-07-01",
    );
    expect(request?.body).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      system: TRIAGE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: questions }],
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    // Removed on this model: sending them is a 400.
    expect(request?.body).not.toHaveProperty("temperature");
    expect(request?.body).not.toHaveProperty("thinking");
  });

  it("counts each attempt with its model: one declined, and the fallback that answered", async () => {
    reply = {
      status: 200,
      body: message({
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 1300,
          output_tokens: 90,
          iterations: [
            {
              type: "message",
              model: null,
              input_tokens: 1200,
              output_tokens: 10,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            {
              type: "fallback_message",
              model: "claude-opus-4-8",
              input_tokens: 1250,
              output_tokens: 80,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 50,
            },
          ],
        },
      }),
    };

    const answer = await triage();

    expect(answer.attempts).toEqual([
      { model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 10 },
      { model: "claude-opus-4-8", inputTokens: 1300, outputTokens: 80 },
    ]);
    expect(answer.usage).toEqual({ inputTokens: 2500, outputTokens: 90 });
  });

  it("counts cache tokens as input", async () => {
    reply = {
      status: 200,
      body: message({
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 30,
          cache_read_input_tokens: 70,
        },
      }),
    };

    expect((await triage()).usage).toEqual({
      inputTokens: 200,
      outputTokens: 20,
    });
  });

  it("asks for no more output than the run allows", async () => {
    reply = { status: 200, body: message() };
    seen.length = 0;

    await model().triage(questions, new AbortController().signal, 1_400);

    expect(seen[0]?.body).toMatchObject({ max_tokens: 1_400 });
  });

  it("records the model that answered, a fallback included", async () => {
    reply = { status: 200, body: message({ model: "claude-opus-4-8" }) };

    expect((await triage()).model).toBe("claude-opus-4-8");
  });

  it.each([
    ["a refusal", { stop_reason: "refusal", content: [] }, "REFUSED"],
    [
      "an answer cut off at max_tokens",
      { stop_reason: "max_tokens" },
      "MALFORMED",
    ],
  ])("turns %s into a failure", async (_label, overrides, kind) => {
    reply = { status: 200, body: message(overrides) };

    const failure = await triage().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TriageModelError);
    expect((failure as TriageModelError).kind).toBe(kind);
  });

  it("turns an answer that is not the schema into a failure", async () => {
    reply = {
      status: 200,
      body: message({
        content: [{ type: "text", text: '{"groups": "nope"}' }],
      }),
    };

    const failure = await triage().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TriageModelError);
    expect((failure as TriageModelError).kind).toBe("MALFORMED");
  });

  it("turns an unreachable provider into 'unavailable'", async () => {
    const nowhere = new AnthropicTriageModel(
      "claude-opus-5-5",
      "test-key",
      "http://127.0.0.1:9",
    );

    const failure = await nowhere
      .triage(questions, new AbortController().signal)
      .catch((error: unknown) => error);

    expect((failure as TriageModelError).kind).toBe("UNAVAILABLE");
    expect((failure as TriageModelError).message).toBe(
      "The AI provider could not be reached",
    );
  });

  it("turns a provider error into 'unavailable', once, without retrying", async () => {
    reply = {
      status: 529,
      body: {
        type: "error",
        error: { type: "overloaded_error", message: "Overloaded" },
      },
    };
    seen.length = 0;

    const failure = await triage().catch((error: unknown) => error);

    expect((failure as TriageModelError).kind).toBe("UNAVAILABLE");
    expect((failure as TriageModelError).message).toBe(
      "The AI provider answered 529",
    );
    expect(seen).toHaveLength(1);
  });

  it("stops waiting when the run's signal is aborted, with its reason", async () => {
    reply = { status: 200, body: message(), delayMs: 2_000 };
    const controller = new AbortController();
    const reason = new Error("timed out");

    const pending = model().triage(questions, controller.signal);
    setTimeout(() => {
      controller.abort(reason);
    }, 50);

    await expect(pending).rejects.toBe(reason);
  });
});
