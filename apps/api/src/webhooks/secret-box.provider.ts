import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { SecretBox } from "./secret-box.js";

/** The SecretBox, or null when WEBHOOK_ENCRYPTION_KEY is not set. */
export const SECRET_BOX = Symbol("SECRET_BOX");

export const secretBoxProvider = {
  provide: SECRET_BOX,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): SecretBox | null =>
    config.webhooks.encryptionKey === undefined
      ? null
      : new SecretBox(
          config.webhooks.encryptionKey,
          config.webhooks.previousEncryptionKey,
        ),
};
