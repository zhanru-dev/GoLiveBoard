"use client";

import type { AttendeeMe } from "@opspilot/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/** What a signed-in attendee sees in place of the registration form. */
export function AttendeePanel({
  slug,
  me,
}: Readonly<{ slug: string; me: AttendeeMe }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await api(`/public/events/${slug}/sign-out`, { method: "POST" });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <Alert role="status">
      <AlertDescription className="grid gap-3">
        <p>
          You are registered as <strong>{me.name}</strong>.{" "}
          {me.remindersOptIn
            ? "We will remind you a day and an hour before it starts."
            : "You will not get reminders."}
        </p>
        <div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Sign out of this event
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
