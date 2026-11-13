import { z } from "zod";

const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;

const MAX_TCP_PORT = 65_535;
/** HS256 keys shorter than the hash output (32 bytes) weaken the signature. */
const MIN_SECRET_LENGTH = 32;

const Secret = z
  .string()
  .min(MIN_SECRET_LENGTH, `Must be at least ${MIN_SECRET_LENGTH} characters`);

/**
 * The environment variables the API reads. Settings have defaults that suit
 * local development; connection strings are required, because they hold
 * credentials (`.env.example` has the local values).
 */
const AppConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    API_HOST: z.string().min(1).default("127.0.0.1"),
    API_PORT: z.coerce.number().int().min(1).max(MAX_TCP_PORT).default(4301),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    LOG_FORMAT: z.enum(["json", "pretty"]).default("json"),
    DATABASE_URL: z.url({
      protocol: /^postgres(ql)?$/,
      error: "Must be a postgres:// URL",
    }),
    VALKEY_URL: z.url({
      protocol: /^rediss?$/,
      error: "Must be a redis:// or rediss:// URL",
    }),
    /** Where browsers load the app; state-changing requests must come from it. */
    APP_ORIGIN: z.url({ protocol: /^https?$/ }),
    /** Signs access tokens. */
    JWT_SECRET: Secret,
    /**
     * The previous signing key during a rotation: tokens it signed stay valid
     * until they expire, so rotating the key signs nobody out.
     */
    JWT_SECRET_PREVIOUS: Secret.optional(),
    SMTP_URL: z.url({ protocol: /^smtps?$/ }),
    MAIL_FROM: z.string().min(1),
  })
  .refine(
    (env) => !(env.NODE_ENV === "production" && env.LOG_FORMAT === "pretty"),
    {
      path: ["LOG_FORMAT"],
      message:
        "Must be json in production, where logs are collected by machines",
    },
  )
  .transform((env) => ({
    environment: env.NODE_ENV,
    api: { host: env.API_HOST, port: env.API_PORT },
    log: { level: env.LOG_LEVEL, format: env.LOG_FORMAT },
    database: { url: env.DATABASE_URL },
    valkey: { url: env.VALKEY_URL },
    // `new URL(…).origin` normalises the value (no trailing slash, lower case).
    app: { origin: new URL(env.APP_ORIGIN).origin },
    auth: {
      jwtSecret: env.JWT_SECRET,
      jwtPreviousSecret: env.JWT_SECRET_PREVIOUS,
    },
    mail: { smtpUrl: env.SMTP_URL, from: env.MAIL_FROM },
  }));

export type AppConfig = z.output<typeof AppConfigSchema>;

/** Dependency-injection token for the validated configuration. */
export const APP_CONFIG = Symbol("APP_CONFIG");

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/**
 * Validates environment variables and returns typed configuration.
 *
 * @throws ConfigError listing every invalid variable at once, so a broken
 * deployment is fixed in one attempt rather than one variable at a time.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = AppConfigSchema.safeParse(env);
  if (result.success) {
    return result.data;
  }
  const problems = result.error.issues.map(
    (issue) => `  - ${issue.path.join(".")}: ${issue.message}`,
  );
  throw new ConfigError(["Invalid configuration:", ...problems].join("\n"));
}
