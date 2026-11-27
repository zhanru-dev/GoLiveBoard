import "reflect-metadata";

import { readdirSync } from "node:fs";

import { type Role } from "@goliveboard/contracts";
import { ROUTES, type RouteSpec } from "@goliveboard/contracts/openapi";
import { RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";

import { AttendeeGuard } from "../attendees/attendee.guard.js";
import { IS_PUBLIC, REQUIRED_ROLE } from "../auth/actor.js";

type Constructor = abstract new (...args: never[]) => unknown;

/** Every controller file, so a new controller is checked without listing it. */
const CONTROLLER_FILES = readdirSync(new URL("../", import.meta.url), {
  recursive: true,
  encoding: "utf8",
})
  .filter((file) => file.endsWith(".controller.ts"))
  .map((file) => `../${file}`);

function joinPath(...parts: (string | undefined)[]): string {
  const segments = parts
    .flatMap((part) => (part ?? "").split("/"))
    .filter((segment) => segment !== "")
    .map((segment) => segment.replace(/^:(\w+)$/, "{$1}"));
  return `/${segments.join("/")}`;
}

/** Metadata on the handler wins over the controller's, as Reflector does. */
function metadata(key: string, handler: object, controller: object): unknown {
  return (
    (Reflect.getMetadata(key, handler) as unknown) ??
    (Reflect.getMetadata(key, controller) as unknown)
  );
}

function guards(target: object): unknown[] {
  return (
    (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ??
    []
  );
}

function accessOf(handler: object, controller: object): string {
  if (metadata(IS_PUBLIC, handler, controller) !== true) {
    const role = metadata(REQUIRED_ROLE, handler, controller) as
      Role | undefined;
    return `staff:${role ?? "ANALYST"}`;
  }
  const attendee = [...guards(controller), ...guards(handler)].includes(
    AttendeeGuard,
  );
  return attendee ? "attendee" : "public";
}

/** `GET /events/{eventId} staff:ANALYST 200`, from the controllers' decorators. */
async function routesInControllers(): Promise<string[]> {
  const modules = await Promise.all(
    CONTROLLER_FILES.map(
      (file) => import(file) as Promise<Record<string, unknown>>,
    ),
  );
  const found: string[] = [];
  for (const exported of modules.flatMap((module) => Object.values(module))) {
    if (typeof exported !== "function") continue;
    const controller = exported as Constructor;
    const prefix = Reflect.getMetadata(PATH_METADATA, controller) as
      string | undefined;
    if (prefix === undefined) continue;
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (typeof handler !== "function") continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        RequestMethod | undefined;
      if (method === undefined) continue;
      const verb = RequestMethod[method];
      const status =
        (Reflect.getMetadata(HTTP_CODE_METADATA, handler) as
          number | undefined) ?? (verb === "POST" ? 201 : 200);
      const path = joinPath(
        prefix,
        Reflect.getMetadata(PATH_METADATA, handler) as string | undefined,
      );
      found.push(
        `${verb} ${path} ${accessOf(handler, controller)} ${String(status)}`,
      );
    }
  }
  return found.sort();
}

function accessInRegistry({ access }: RouteSpec): string {
  if (access.kind === "staff") return `staff:${access.role}`;
  // The refresh cookie is checked by the handler, not by a guard.
  if (access.kind === "refresh") return "public";
  return access.kind;
}

function routeInRegistry(route: RouteSpec): string {
  return `${route.method.toUpperCase()} ${route.path} ${accessInRegistry(route)} ${String(route.status)}`;
}

describe("the OpenAPI route registry", () => {
  it("matches every controller route: path, method, session, role and status", async () => {
    const inControllers = await routesInControllers();
    expect(inControllers.length).toBeGreaterThan(0);
    expect(ROUTES.map(routeInRegistry).sort()).toEqual(inControllers);
  });
});
