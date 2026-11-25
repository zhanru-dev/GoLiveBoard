import type { Provider } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { AnthropicTriageModel } from "./anthropic-triage-model.js";
import { OfflineTriageModel } from "./offline-triage-model.js";
import { TRIAGE_MODEL, type TriageModel } from "./triage-model.js";

/** The model AI_PROVIDER names, or null when triage is off. */
export const triageModelProvider: Provider = {
  provide: TRIAGE_MODEL,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): TriageModel | null => {
    const { provider, apiKey, baseUrl, model } = config.triage;
    switch (provider) {
      case "anthropic":
        return apiKey === undefined
          ? null
          : new AnthropicTriageModel(model, apiKey, baseUrl);
      case "offline":
        return new OfflineTriageModel();
      case "none":
        return null;
    }
  },
};
