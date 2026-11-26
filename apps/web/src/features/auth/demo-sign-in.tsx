"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

/**
 * One-click sign-in to the shared demo workspace (FR-AUTH-5). The sign-in
 * page shows it only when the server runs in demo mode.
 */
export function DemoSignIn() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function signIn() {
    setError("");
    setPending(true);
    try {
      await api("/auth/demo", { method: "POST" });
      router.replace("/events");
      router.refresh();
    } catch (failure) {
      setError(errorMessage(failure));
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="demo-heading"
      className="grid gap-3 rounded-lg border bg-muted/40 p-4"
    >
      <h2 id="demo-heading" className="font-medium">
        Just looking?
      </h2>
      <p className="text-sm text-muted-foreground">
        Try GoLiveBoard in a shared demo workspace, no account needed. Anyone
        trying the demo sees what you enter, and it is reset every night.
      </p>
      <FormAlert message={error} />
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => void signIn()}
      >
        Try the demo
      </Button>
    </section>
  );
}
