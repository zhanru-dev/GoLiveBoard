import { z } from "zod";

import * as contracts from "../index.js";
import { PROBLEM_JSON_CONTENT_TYPE } from "../problem-details.js";
import { type Access, type RawBody, ROUTES, type RouteSpec } from "./routes.js";

type Json = Record<string, unknown>;
type Io = "input" | "output";

const REPOSITORY = "https://github.com/zhanru-dev/GoLiveBoard/blob/main";

const DESCRIPTION = `The HTTP API behind GoLiveBoard, generated from the Zod schemas the API validates with (\`packages/contracts\`). The full conventions are in [docs/04](${REPOSITORY}/docs/04-api-and-contracts.md); in short:

- **Sessions are cookies** (\`HttpOnly\`), never tokens in headers or URLs. Each operation names the cookie it needs.
- **State-changing requests must send \`Origin\`** equal to the application's origin.
- **Staff routes act on the session's active workspace.** Send \`X-Workspace-Id\` with the workspace you are showing; if the session has switched since, the answer is \`409 WORKSPACE_CHANGED\`. Another workspace's resources are always \`404\`.
- **Editable resources return an \`ETag\`.** Updates marked so need \`If-Match\` with it: \`428\` without, \`412\` when stale.
- **Errors are problem details** (\`application/problem+json\`) with a stable \`code\`.
- Lists are cursor-paginated: \`?limit=&cursor=\` → \`{ items, nextCursor }\`.

Chat is sent over Socket.IO, and webhooks are delivered to your endpoints; both are described in docs/04, sections 4 and 6, not here.`;

/** Every schema `packages/contracts` exports, by the name it exports it as. */
const NAMES = new Map<unknown, string>(
  Object.entries(contracts)
    .filter(([, value]) => value instanceof z.ZodType)
    .map(([name, value]) => [value, name]),
);

function toJson(schema: z.ZodType, io: Io): Json {
  const json = z.toJSONSchema(schema, {
    io,
    target: "draft-2020-12",
    unrepresentable: "throw",
    // A format says it more readably than the regular expression behind it.
    override: ({ jsonSchema }) => {
      if (jsonSchema.format !== undefined) jsonSchema.pattern = undefined;
    },
  }) as Json;
  return Object.fromEntries(
    Object.entries(json).filter(([key]) => key !== "$schema"),
  );
}

const ACCESS_TEXT: Readonly<Record<Access["kind"], string>> = {
  staff: "",
  attendee: "Needs an attendee session.",
  public: "No session needed.",
  refresh: "Acts on the session named by the refresh cookie.",
};

const ROLE_TEXT = {
  ANALYST: "Any member of the workspace.",
  MANAGER: "Managers and Owners.",
  OWNER: "Owners only.",
} as const;

const SECURITY: Readonly<Record<Access["kind"], Json[]>> = {
  staff: [{ staffSession: [] }],
  attendee: [{ attendeeSession: [] }],
  public: [],
  refresh: [{ refreshSession: [] }],
};

function isRaw(response: RouteSpec["response"]): response is RawBody {
  return response !== undefined && !(response instanceof z.ZodType);
}

class Builder {
  readonly schemas: Record<string, Json> = {};

  /** A named schema becomes a component; an array of one, an array of refs. */
  ref(schema: z.ZodType, io: Io): Json {
    const name = NAMES.get(schema);
    if (name !== undefined) {
      const json = toJson(schema, io);
      const existing = this.schemas[name];
      if (
        existing !== undefined &&
        JSON.stringify(existing) !== JSON.stringify(json)
      ) {
        throw new Error(`${name} differs as a request and as a response`);
      }
      this.schemas[name] = json;
      return { $ref: `#/components/schemas/${name}` };
    }
    if (schema instanceof z.ZodArray) {
      return {
        type: "array",
        items: this.ref(schema.element as z.ZodType, io),
      };
    }
    return toJson(schema, io);
  }

  parameters(route: RouteSpec): Json[] {
    const parameters: Json[] = Object.entries(route.params ?? {}).map(
      ([name, schema]) => ({
        name,
        in: "path",
        required: true,
        schema: toJson(schema, "input"),
      }),
    );
    if (route.query !== undefined) {
      const query = toJson(route.query, "input");
      const required = new Set((query.required as string[] | undefined) ?? []);
      for (const [name, schema] of Object.entries(
        (query.properties as Json | undefined) ?? {},
      )) {
        parameters.push({
          name,
          in: "query",
          required: required.has(name),
          schema,
        });
      }
    }
    if (route.ifMatch) {
      parameters.push({
        name: "If-Match",
        in: "header",
        required: true,
        description: "The resource's current `ETag`.",
        schema: { type: "string" },
      });
    }
    if (route.idempotencyKey) {
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: false,
        description:
          "A retry with the same key and body returns the original response; with another body, `422`. Keys last 24 hours.",
        schema: { type: "string", format: "uuid" },
      });
    }
    if (route.access.kind === "staff") {
      parameters.push({ $ref: "#/components/parameters/WorkspaceId" });
    }
    return parameters;
  }

  responses(route: RouteSpec): Json {
    const responses: Json = {};
    const { response } = route;
    if (response === undefined) {
      responses[String(route.status)] = { description: "Done" };
    } else if (isRaw(response)) {
      responses[String(route.status)] = {
        description: response.description,
        content: { [response.contentType]: {} },
      };
    } else {
      responses[String(route.status)] = {
        description: "Done",
        content: {
          "application/json": { schema: this.ref(response, "output") },
        },
      };
    }
    for (const [status, other] of Object.entries(route.otherResponses ?? {})) {
      responses[status] = {
        description: other.description,
        ...(other.schema === undefined
          ? {}
          : {
              content: {
                "application/json": {
                  schema: this.ref(other.schema, "output"),
                },
              },
            }),
      };
    }
    responses.default = { $ref: "#/components/responses/Problem" };
    return responses;
  }

  operation(route: RouteSpec): Json {
    const who =
      route.access.kind === "staff"
        ? ROLE_TEXT[route.access.role]
        : ACCESS_TEXT[route.access.kind];
    const description = [route.description, who]
      .filter((part) => part !== undefined)
      .join("\n\n");
    const parameters = this.parameters(route);
    return {
      operationId: route.operationId,
      tags: [route.tag],
      summary: route.summary,
      description,
      security: SECURITY[route.access.kind],
      ...(route.access.kind === "staff"
        ? { "x-required-role": route.access.role }
        : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(route.body === undefined
        ? {}
        : {
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: this.ref(route.body, "input") },
              },
            },
          }),
      responses: this.responses(route),
    };
  }
}

/** The OpenAPI 3.1 document for every route in ROUTES. */
export function buildOpenApiDocument(): Json {
  const builder = new Builder();
  const paths: Record<string, Json> = {};
  for (const route of ROUTES) {
    const methods = (paths[route.path] ??= {});
    methods[route.method] = builder.operation(route);
  }
  builder.schemas.ProblemDetails = toJson(contracts.ProblemDetails, "output");
  const schemas = Object.fromEntries(
    Object.entries(builder.schemas).sort(([a], [b]) => a.localeCompare(b)),
  );
  return {
    openapi: "3.1.1",
    info: { title: "GoLiveBoard API", version: "v1", description: DESCRIPTION },
    servers: [{ url: "/api/v1" }],
    tags: [...new Set(ROUTES.map((route) => route.tag))].map((name) => ({
      name,
    })),
    paths,
    components: {
      schemas,
      parameters: {
        WorkspaceId: {
          name: "X-Workspace-Id",
          in: "header",
          required: false,
          description:
            "The workspace the client is showing; `409 WORKSPACE_CHANGED` if the session has switched since.",
          schema: { type: "string", format: "uuid" },
        },
      },
      responses: {
        Problem: {
          description: "An error, as problem details",
          content: {
            [PROBLEM_JSON_CONTENT_TYPE]: {
              schema: { $ref: "#/components/schemas/ProblemDetails" },
            },
          },
        },
      },
      securitySchemes: {
        staffSession: {
          type: "apiKey",
          in: "cookie",
          name: "__Host-goliveboard_access",
          description: "A staff session, set by sign-in.",
        },
        attendeeSession: {
          type: "apiKey",
          in: "cookie",
          name: "__Host-goliveboard_attendee",
          description: "An attendee session, set by verification.",
        },
        refreshSession: {
          type: "apiKey",
          in: "cookie",
          name: "__Secure-goliveboard_refresh",
          description: "The refresh token, sent only to /api/v1/auth.",
        },
      },
    },
  };
}
