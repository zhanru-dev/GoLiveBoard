"use client";

import { AttendeeVerified } from "@goliveboard/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useLinkToken } from "@/features/auth/use-link-token";
import { ApiError, api } from "@/lib/api";

type State =
  | { readonly kind: "working" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Uses the link from the verification email (FR-AD-3): once, then on to the
 * event page as a signed-in attendee.
 */
export function VerifyAttendee({ slug }: Readonly<{ slug: string }>) {
  const token = useLinkToken();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "working" });
  // The link works once: never send it twice, even if the effect runs twice.
  const sent = useRef(false);

  useEffect(() => {
    if (token === "" || sent.current) {
      return;
    }
    sent.current = true;
    api("/public/attendee-verifications", {
      method: "POST",
      body: { token },
      schema: AttendeeVerified,
    }).then(
      (verified) => {
        router.replace(`/e/${verified.slug}`);
      },
      (error: unknown) => {
        setState({ kind: "failed", message: failure(error) });
      },
    );
  }, [token, router]);

  if (state.kind === "failed") {
    return (
      <div role="alert" className="grid gap-2">
        <p>{state.message}</p>
        <p>
          <a className="underline" href={`/e/${slug}`}>
            Back to the event page
          </a>{" "}
          to ask for a new link.
        </p>
      </div>
    );
  }
  return <p role="status">Confirming your registration…</p>;
}

function failure(error: unknown): string {
  if (error instanceof ApiError && error.problem.code === "TOKEN_INVALID") {
    return "This link has expired or has already been used.";
  }
  if (error instanceof ApiError && error.problem.status === 403) {
    return "This event no longer admits you.";
  }
  return "We could not confirm your registration. Try again later.";
}
