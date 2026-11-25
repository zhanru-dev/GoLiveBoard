"use client";

import { type SyntheticEvent, useId, useState } from "react";

import { postPublic } from "@/lib/public-api";

import { PublicButton, PublicField, PublicNotice } from "./public-ui";

type Fields = "name" | "email" | "consent";
type Errors = Partial<Record<Fields, string>>;

/**
 * Registration (FR-AD-3). Whatever happens to the address (new, already
 * registered, not admitted), the answer is the same, so the page says the
 * same thing too: only the mailbox learns more.
 *
 * Plain inputs and a few checks of its own rather than a form library and
 * Zod: the public page has a performance budget (NFR-3), and the API
 * validates every field and answers with field errors.
 */
export function RegistrationForm({
  slug,
  privacyNoticeVersion,
  demoMode,
}: Readonly<{
  slug: string;
  privacyNoticeVersion: string;
  demoMode: boolean;
}>) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const consentErrorId = useId();

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = data.get(key);
      return typeof value === "string" ? value.trim() : "";
    };
    const name = text("name");
    const email = text("email");
    const consent = data.get("consent") === "on";
    const found: Errors = {
      ...(name === "" && { name: "Enter your name" }),
      ...(email === "" && { email: "Enter your email address" }),
      ...(!consent && { consent: "Agree to the privacy notice to register" }),
    };
    setErrors(found);
    setFormError("");
    if (Object.keys(found).length > 0) {
      return;
    }
    setBusy(true);
    const result = await postPublic(`/public/events/${slug}/registrations`, {
      name,
      email,
      privacyNoticeVersion,
      consent: true,
      remindersOptIn: data.get("remindersOptIn") === "on",
    });
    setBusy(false);
    if (result.ok) {
      setSent(true);
      return;
    }
    const placed: Errors = {};
    const unplaced: string[] = [];
    for (const error of result.errors) {
      if (
        error.path === "name" ||
        error.path === "email" ||
        error.path === "consent"
      ) {
        placed[error.path] = error.message;
      } else {
        unplaced.push(error.message);
      }
    }
    setErrors(placed);
    if (Object.keys(placed).length === 0 || unplaced.length > 0) {
      setFormError(unplaced.join(" ") || result.message);
    }
  }

  if (sent) {
    return (
      <PublicNotice role="status">
        <p>
          Check your inbox. If this address can register, we have sent it a link
          to confirm and join. The link works once, within 15 minutes.
        </p>
        {demoMode ? (
          <p>
            This is the demo: nothing is really sent.{" "}
            <a className="underline" href="/demo-inbox">
              Open the demo inbox
            </a>
            .
          </p>
        ) : null}
      </PublicNotice>
    );
  }

  return (
    <form
      method="post"
      onSubmit={(event) => void submit(event)}
      noValidate
      className="grid gap-4"
      aria-label="Register"
    >
      {formError === "" ? null : (
        <PublicNotice role="alert">{formError}</PublicNotice>
      )}
      <PublicField
        label="Name"
        name="name"
        autoComplete="name"
        maxLength={100}
        error={errors.name}
      />
      <PublicField
        label="Email address"
        name="email"
        type="email"
        autoComplete="email"
        maxLength={254}
        error={errors.email}
      />
      <div className="grid gap-1">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="consent"
            className="mt-1"
            aria-invalid={errors.consent !== undefined}
            aria-describedby={
              errors.consent === undefined ? undefined : consentErrorId
            }
          />
          I have read the privacy notice and agree to it.
        </label>
        {errors.consent === undefined ? null : (
          <p id={consentErrorId} className="text-sm text-destructive">
            {errors.consent}
          </p>
        )}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="remindersOptIn"
          defaultChecked
          className="mt-1"
        />
        Remind me a day and an hour before it starts.
      </label>
      <PublicButton type="submit" disabled={busy}>
        Register
      </PublicButton>
    </form>
  );
}
