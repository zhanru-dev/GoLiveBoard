import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import { PROBLEM_JSON_CONTENT_TYPE } from "@opspilot/contracts";
import type { Request, Response } from "express";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { resolveRequestId } from "../observability/request-id.js";
import { toProblemResponse } from "./problem-response.js";

/**
 * The single place where errors become HTTP responses. Controllers and services
 * throw; this filter answers with `application/problem+json` (RFC 9457).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(ProblemDetailsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // Real-time gateways get their own filter (milestone 6).
    if (host.getType() !== "http") {
      throw exception;
    }
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();

    // Normally set by the request logger; a request it never saw gets a new ID.
    const requestId =
      typeof request.id === "string"
        ? request.id
        : resolveRequestId(request.headers["x-request-id"]);
    const problem = toProblemResponse(exception, requestId);

    if (problem.unexpected) {
      this.logger.error({ err: exception }, "Unhandled error");
    }
    // A response that has started streaming cannot be replaced; Express will
    // close the connection.
    if (response.headersSent) {
      return;
    }
    response
      .status(problem.status)
      .type(PROBLEM_JSON_CONTENT_TYPE)
      .json(problem.body);
  }
}
