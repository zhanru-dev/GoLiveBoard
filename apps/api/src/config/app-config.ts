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

/** "true" or "false" in the environment. */
const Flag = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

/**
 * An optional setting. Compose passes `${VAR:-}` as an empty string when the
 * variable is unset, which means "not set" rather than "invalid".
 */
function optional<Schema extends z.ZodType>(schema: Schema) {
  return z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );
}

/** 32 bytes, base64: an AES-256 key. */
const EncryptionKey = z.preprocess(
  // Empty means not set, as in an .env line left blank.
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .transform((value) => Buffer.from(value, "base64"))
    .refine((key) => key.length === 32, {
      error: "Must be 32 bytes, base64 (openssl rand -base64 32)",
    })
    .optional(),
);

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
    /**
     * Proxies in front of the API (Caddy: 1). Express then takes the client
     * address from X-Forwarded-For, which rate limits depend on; 0 trusts none.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /**
     * How often the real-time gateway re-checks every connection, whatever
     * signals arrived: the backstop for a lost signal, and how expired
     * sessions end. Tests shorten it.
     */
    REALTIME_SWEEP_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(5 * 60_000)
      .default(30_000),
    /**
     * Prefix of the Valkey channels the real-time gateways of one deployment
     * share (fan-out and signals): deployments that share a Valkey, or test
     * files running side by side, must not hear each other.
     */
    REALTIME_CHANNEL_PREFIX: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/)
      .default("opspilot"),
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
    /**
     * Seals webhook signing secrets at rest (AES-256-GCM): 32 random bytes,
     * base64 (`openssl rand -base64 32`). Without it, webhook endpoints
     * cannot be created. The previous key keeps opening what it sealed
     * during a rotation.
     */
    WEBHOOK_ENCRYPTION_KEY: EncryptionKey,
    WEBHOOK_ENCRYPTION_KEY_PREVIOUS: EncryptionKey,
    /**
     * Prefix of every BullMQ key in Valkey. Tests give each file its own, so
     * their queues never share jobs.
     */
    QUEUE_PREFIX: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/)
      .default("opspilot"),
    /** Amazon S3 when unset; SeaweedFS locally. */
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
    /**
     * The endpoint browsers reach, which presigned URLs name. Differs from
     * S3_ENDPOINT when the API reaches storage over an internal network.
     */
    S3_PUBLIC_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
    S3_REGION: z.string().min(1).default("eu-west-2"),
    S3_BUCKET: z.string().min(3).max(63).default("opspilot-assets"),
    /** Unset in production, where the instance role supplies credentials. */
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** SeaweedFS needs path-style URLs (`host/bucket/key`). */
    S3_FORCE_PATH_STYLE: Flag,
    /** Create the bucket and its CORS rule at start-up (local and tests). */
    S3_CREATE_BUCKET: Flag,
    SMTP_URL: z.url({ protocol: /^smtps?$/ }),
    MAIL_FROM: z.string().min(1),
    /**
     * Demo mode (FR-AUTH-5): one-click sign-in to the shared demo workspace,
     * and its nightly reset. The demo environment only.
     */
    DEMO_MODE: Flag,
    /**
     * AI question triage (FR-RN-6, ADR-0012). `none`: suggestions are
     * unavailable and Q&A works as ever. `anthropic`: Claude, with
     * ANTHROPIC_API_KEY. `offline`: groups questions whose words are the
     * same, with no model at all (development and browser tests only).
     */
    AI_PROVIDER: z.enum(["none", "anthropic", "offline"]).default("none"),
    ANTHROPIC_API_KEY: optional(z.string().min(1)),
    /** Another endpoint for the Anthropic API (tests, proxies). */
    ANTHROPIC_BASE_URL: optional(z.url({ protocol: /^https?$/ })),
    AI_TRIAGE_MODEL: z.string().min(1).max(100).default("claude-opus-5-5"),
    /** Where errors are reported; reporting is off when unset. */
    SENTRY_DSN: optional(z.url({ protocol: /^https?$/ })),
    /** Defaults to NODE_ENV. */
    SENTRY_ENVIRONMENT: optional(z.string().min(1).max(64)),
    /** The build, e.g. the commit SHA the images are tagged with. */
    SENTRY_RELEASE: optional(z.string().min(1).max(200)),
  })
  .refine(
    (env) => !(env.NODE_ENV === "production" && env.LOG_FORMAT === "pretty"),
    {
      path: ["LOG_FORMAT"],
      message:
        "Must be json in production, where logs are collected by machines",
    },
  )
  .refine(
    (env) =>
      env.AI_PROVIDER !== "anthropic" || env.ANTHROPIC_API_KEY !== undefined,
    {
      path: ["ANTHROPIC_API_KEY"],
      message: "Required when AI_PROVIDER is anthropic",
    },
  )
  .refine(
    (env) =>
      (env.S3_ACCESS_KEY_ID === undefined) ===
      (env.S3_SECRET_ACCESS_KEY === undefined),
    {
      path: ["S3_SECRET_ACCESS_KEY"],
      message: "Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither",
    },
  )
  .transform((env) => ({
    environment: env.NODE_ENV,
    api: {
      host: env.API_HOST,
      port: env.API_PORT,
      trustProxyHops: env.TRUST_PROXY_HOPS,
    },
    realtime: {
      sweepMs: env.REALTIME_SWEEP_MS,
      channelPrefix: env.REALTIME_CHANNEL_PREFIX,
    },
    log: { level: env.LOG_LEVEL, format: env.LOG_FORMAT },
    database: { url: env.DATABASE_URL },
    valkey: { url: env.VALKEY_URL },
    queues: { prefix: env.QUEUE_PREFIX },
    // `new URL(…).origin` normalises the value (no trailing slash, lower case).
    app: { origin: new URL(env.APP_ORIGIN).origin },
    auth: {
      jwtSecret: env.JWT_SECRET,
      jwtPreviousSecret: env.JWT_SECRET_PREVIOUS,
    },
    webhooks: {
      encryptionKey: env.WEBHOOK_ENCRYPTION_KEY,
      previousEncryptionKey: env.WEBHOOK_ENCRYPTION_KEY_PREVIOUS,
    },
    mail: { smtpUrl: env.SMTP_URL, from: env.MAIL_FROM },
    demo: { enabled: env.DEMO_MODE },
    triage: {
      provider: env.AI_PROVIDER,
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: env.ANTHROPIC_BASE_URL,
      model: env.AI_TRIAGE_MODEL,
    },
    errorReporting: {
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      release: env.SENTRY_RELEASE,
    },
    storage: {
      endpoint: env.S3_ENDPOINT,
      publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      credentials:
        env.S3_ACCESS_KEY_ID === undefined ||
        env.S3_SECRET_ACCESS_KEY === undefined
          ? undefined
          : {
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            },
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      createBucket: env.S3_CREATE_BUCKET,
    },
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
