import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import {
  AcceptInvitationRequest,
  CreateInvitationRequest,
  type Invitation,
  type InvitationPreview,
  InvitationTokenRequest,
  type Member,
  UpdateMemberRequest,
  UpdateWorkspaceRequest,
  type Workspace,
} from "@goliveboard/contracts";

import {
  type Actor,
  CurrentActor,
  Public,
  RequireRole,
} from "../auth/actor.js";
import { InvitationsService } from "./invitations.service.js";
import { MembersService } from "./members.service.js";
import { WorkspaceService } from "./workspace.service.js";

/** Everything here acts on the session's active workspace (FR-WS-4). */
@Controller("workspace")
export class WorkspaceController {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly members: MembersService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get()
  get(@CurrentActor() actor: Actor): Promise<Workspace> {
    return this.workspace.get(actor);
  }

  @Patch()
  @RequireRole("OWNER")
  update(
    @CurrentActor() actor: Actor,
    @Body({ schema: UpdateWorkspaceRequest }) body: UpdateWorkspaceRequest,
  ): Promise<Workspace> {
    return this.workspace.update(actor, body);
  }

  @Get("members")
  listMembers(@CurrentActor() actor: Actor): Promise<Member[]> {
    return this.members.list(actor);
  }

  @Patch("members/:membershipId")
  @RequireRole("OWNER")
  @HttpCode(204)
  changeRole(
    @CurrentActor() actor: Actor,
    @Param("membershipId", ParseUUIDPipe) membershipId: string,
    @Body({ schema: UpdateMemberRequest }) body: UpdateMemberRequest,
  ): Promise<void> {
    return this.members.changeRole(actor, membershipId, body.role);
  }

  @Delete("members/:membershipId")
  @RequireRole("OWNER")
  @HttpCode(204)
  removeMember(
    @CurrentActor() actor: Actor,
    @Param("membershipId", ParseUUIDPipe) membershipId: string,
  ): Promise<void> {
    return this.members.remove(actor, membershipId);
  }

  @Post("members/:membershipId/sign-out")
  @RequireRole("OWNER")
  @HttpCode(204)
  signMemberOut(
    @CurrentActor() actor: Actor,
    @Param("membershipId", ParseUUIDPipe) membershipId: string,
  ): Promise<void> {
    return this.members.signOutEverywhere(actor, membershipId);
  }

  @Get("invitations")
  @RequireRole("OWNER")
  listInvitations(@CurrentActor() actor: Actor): Promise<Invitation[]> {
    return this.invitations.list(actor);
  }

  @Post("invitations")
  @RequireRole("OWNER")
  invite(
    @CurrentActor() actor: Actor,
    @Body({ schema: CreateInvitationRequest }) body: CreateInvitationRequest,
  ): Promise<Invitation> {
    return this.invitations.create(actor, body);
  }

  @Delete("invitations/:invitationId")
  @RequireRole("OWNER")
  @HttpCode(204)
  revokeInvitation(
    @CurrentActor() actor: Actor,
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    return this.invitations.revoke(actor, invitationId);
  }
}

/** Used by invitees, who may not have an account yet. */
@Public()
@Controller("team-invitations")
export class TeamInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post("preview")
  @HttpCode(200)
  preview(
    @Body({ schema: InvitationTokenRequest }) body: InvitationTokenRequest,
  ): Promise<InvitationPreview> {
    return this.invitations.preview(body.token);
  }

  @Post("accept")
  @HttpCode(204)
  accept(
    @Body({ schema: AcceptInvitationRequest }) body: AcceptInvitationRequest,
  ): Promise<void> {
    return this.invitations.accept(body);
  }
}
