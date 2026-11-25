import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import { PROBLEM_JSON_CONTENT_TYPE } from "@opspilot/contracts";
import type { Request, Response } from "express";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { REQUEST_ID_HEADER, requestIdOf } from "../observability/request-id.js";
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
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const requestId = requestIdOf(request);
    const problem = toProblemResponse(exception, requestId);

    if (problem.unexpected) {
      this.logger.error({ err: exception }, "Unhandled error");
    }
    // Part of a response has already been sent, so a problem body can no longer
    // replace it. Ending normally would let the client take the partial body
    // as complete; destroying the connection tells it the response failed.
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response
      .status(problem.status)
      .setHeader(REQUEST_ID_HEADER, requestId)
      .type(PROBLEM_JSON_CONTENT_TYPE)
      .json(problem.body);
  }
}
