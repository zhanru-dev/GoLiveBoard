"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useLinkToken } from "@/features/auth/use-link-token";
import { api } from "@/lib/api";

/**
 * Stops reminders (FR-AD-5). Asks for a click rather than acting on page
 * load, so a mail scanner that follows the link stops nothing.
 */
export function UnsubscribeForm() {
  const token = useLinkToken();
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">(
    "idle",
  );

  async function stop() {
    setState("busy");
    try {
      await api("/public/reminders/unsubscribe", {
        method: "POST",
        body: { token },
      });
      setState("done");
    } catch {
      setState("failed");
    }
  }

  if (state === "done") {
    return <p role="status">Done. You will not get any more reminders.</p>;
  }
  return (
    <div className="grid gap-4">
      {state === "failed" ? (
        <p role="alert">This link is not valid. Use the one in a reminder.</p>
      ) : null}
      <Button
        disabled={token === "" || state === "busy"}
        onClick={() => void stop()}
      >
        Stop reminders
      </Button>
    </div>
  );
}
