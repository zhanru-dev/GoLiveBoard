"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { RegistrationRequest } from "@opspilot/contracts";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";

/**
 * Registration (FR-AD-3). Whatever happens to the address (new, already
 * registered, not admitted), the answer is the same, so the page says the
 * same thing too: only the mailbox learns more.
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
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegistrationRequest>({
    resolver: zodResolver(RegistrationRequest),
    defaultValues: { privacyNoticeVersion, remindersOptIn: true },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      await api(`/public/events/${slug}/registrations`, {
        method: "POST",
        body: values,
      });
      setSent(true);
    } catch (error) {
      setFormError(
        applyApiError(error, setError, ["name", "email", "consent"]),
      );
    }
  });

  if (sent) {
    return (
      <Alert role="status">
        <AlertDescription>
          <p>
            Check your inbox. If this address can register, we have sent it a
            link to confirm and join. The link works once, within 15 minutes.
          </p>
          {demoMode ? (
            <p className="mt-2">
              This is the demo: nothing is really sent.{" "}
              <a className="underline" href="/demo-inbox">
                Open the demo inbox
              </a>
              .
            </p>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="grid gap-4"
      aria-label="Register"
    >
      <FormAlert message={formError} />
      <FormField
        label="Name"
        autoComplete="name"
        error={errors.name?.message}
        {...register("name")}
      />
      <FormField
        label="Email address"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <input type="hidden" {...register("privacyNoticeVersion")} />
      <div className="grid gap-1">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            aria-invalid={errors.consent !== undefined}
            aria-describedby={
              errors.consent === undefined ? undefined : "consent-error"
            }
            {...register("consent")}
          />
          I have read the privacy notice and agree to it.
        </label>
        {errors.consent === undefined ? null : (
          <p id="consent-error" className="text-sm text-destructive">
            {errors.consent.message}
          </p>
        )}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          {...register("remindersOptIn")}
        />
        Remind me a day and an hour before it starts.
      </label>
      <Button type="submit" disabled={isSubmitting}>
        Register
      </Button>
    </form>
  );
}
