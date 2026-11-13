import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { MailModule } from "../mail/mail.module.js";
import { InvitationsService } from "./invitations.service.js";
import { MembersService } from "./members.service.js";
import {
  TeamInvitationsController,
  WorkspaceController,
} from "./workspace.controller.js";
import { WorkspaceService } from "./workspace.service.js";

@Module({
  imports: [DatabaseModule, MailModule],
  controllers: [WorkspaceController, TeamInvitationsController],
  providers: [WorkspaceService, MembersService, InvitationsService],
})
export class WorkspacesModule {}
