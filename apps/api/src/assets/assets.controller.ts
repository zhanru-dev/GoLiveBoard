import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  type Asset,
  type AssetUpload,
  CreateHoldingSlateUploadRequest,
  type HoldingSlate,
} from "@goliveboard/contracts";

import { type Actor, CurrentActor, RequireRole } from "../auth/actor.js";
import { AssetsService } from "./assets.service.js";

@Controller()
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post("events/:eventId/assets/holding-slate")
  @RequireRole("MANAGER")
  createUpload(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Body({ schema: CreateHoldingSlateUploadRequest })
    body: CreateHoldingSlateUploadRequest,
  ): Promise<AssetUpload> {
    return this.assets.createHoldingSlateUpload(actor, eventId, body);
  }

  @Get("events/:eventId/assets/holding-slate")
  getHoldingSlate(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<HoldingSlate> {
    return this.assets.getHoldingSlate(actor, eventId);
  }

  @Post("assets/:assetId/complete")
  @RequireRole("MANAGER")
  @HttpCode(200)
  complete(
    @CurrentActor() actor: Actor,
    @Param("assetId", ParseUUIDPipe) assetId: string,
  ): Promise<Asset> {
    return this.assets.complete(actor, assetId);
  }
}
