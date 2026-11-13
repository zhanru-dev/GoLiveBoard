"use client";

import { useMe } from "../shell/me-context";
import { InviteForm, PendingInvitations } from "./invitations";
import { MembersTable } from "./members-table";

export function TeamPage() {
  const me = useMe();
  const isOwner = me.activeWorkspace.role === "OWNER";
  return (
    <div className="grid gap-10">
      <section aria-labelledby="members-heading" className="grid gap-4">
        <h1
          id="members-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Team
        </h1>
        <MembersTable />
      </section>
      {isOwner ? (
        <section aria-labelledby="invite-heading" className="grid gap-4">
          <h2 id="invite-heading" className="text-lg font-semibold">
            Invite someone
          </h2>
          <InviteForm />
          <h2 className="text-lg font-semibold">Pending invitations</h2>
          <PendingInvitations />
        </section>
      ) : null}
    </div>
  );
}
