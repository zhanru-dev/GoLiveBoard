import { Controller, Get, Header } from "@nestjs/common";
import { buildOpenApiDocument } from "@goliveboard/contracts/openapi";

import { Public } from "../auth/actor.js";

/** The OpenAPI 3.1 document, generated from the schemas the API validates with. */
@Public()
@Controller()
export class OpenApiController {
  private readonly document = buildOpenApiDocument();

  @Get("openapi.json")
  @Header("Cache-Control", "public, max-age=300")
  get(): Record<string, unknown> {
    return this.document;
  }
}
