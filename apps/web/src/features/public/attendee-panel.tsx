"use client";

import type { AttendeeMe } from "@goliveboard/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { postPublic } from "@/lib/public-api";

import { PublicButton, PublicNotice } from "./public-ui";

/** What a signed-in attendee sees in place of the registration form. */
export function AttendeePanel({
  slug,
  me,
}: Readonly<{ slug: string; me: AttendeeMe }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await postPublic(`/public/events/${slug}/sign-out`);
    setBusy(false);
    router.refresh();
  }

  return (
    <PublicNotice role="status">
      <p>
        You are registered as <strong>{me.name}</strong>.{" "}
        {me.remindersOptIn
          ? "We will remind you a day and an hour before it starts."
          : "You will not get reminders."}
      </p>
      <p>
        <a href={`/e/${slug}/watch`} className="font-medium">
          Go to the event: stream, chat and questions
        </a>
      </p>
      <div>
        <PublicButton
          variant="outline"
          disabled={busy}
          onClick={() => void signOut()}
        >
          Sign out of this event
        </PublicButton>
      </div>
    </PublicNotice>
  );
}
