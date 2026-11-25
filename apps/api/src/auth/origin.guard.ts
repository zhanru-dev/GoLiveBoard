import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { DomainError } from "../shared/domain/domain-error.js";

/** Methods that only read; everything else changes state. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request forgery protection, alongside SameSite cookies
 * (docs/02, section 7.1): browsers always send an Origin header with
 * state-changing requests, and another site cannot fake ours.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }
    if (request.headers.origin !== this.config.app.origin) {
      throw new DomainError("ORIGIN_FORBIDDEN");
    }
    return true;
  }
}
