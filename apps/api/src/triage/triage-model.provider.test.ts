import { describe, expect, it } from "vitest";

import type { AppConfig } from "../config/app-config.js";
import { AnthropicTriageModel } from "./anthropic-triage-model.js";
import { OfflineTriageModel } from "./offline-triage-model.js";
import { triageModelProvider } from "./triage-model.provider.js";

const factory = (triage: AppConfig["triage"]) =>
  (
    triageModelProvider as {
      useFactory: (config: Pick<AppConfig, "triage">) => unknown;
    }
  ).useFactory({ triage });

describe("triageModelProvider", () => {
  it("gives no model when triage is off", () => {
    expect(
      factory({
        provider: "none",
        apiKey: "k",
        baseUrl: undefined,
        model: "m",
      }),
    ).toBeNull();
  });

  it("gives Claude with a key, and the offline grouping when asked", () => {
    expect(
      factory({
        provider: "anthropic",
        apiKey: "k",
        baseUrl: undefined,
        model: "m",
      }),
    ).toBeInstanceOf(AnthropicTriageModel);
    expect(
      factory({
        provider: "offline",
        apiKey: undefined,
        baseUrl: undefined,
        model: "m",
      }),
    ).toBeInstanceOf(OfflineTriageModel);
  });
});
