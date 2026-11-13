"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PasswordResetRequest } from "@opspilot/contracts";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordResetRequest>({
    resolver: zodResolver(PasswordResetRequest),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      await api("/auth/password-reset/request", {
        method: "POST",
        body: values,
      });
      setSent(true);
    } catch (error) {
      setFormError(applyApiError(error, setError, ["email"]));
    }
  });

  if (sent) {
    // Worded so it reveals nothing about whether the account exists.
    return (
      <Alert role="status">
        <AlertDescription>
          If an account uses that address, we have emailed it a link to reset
          the password. The link works once, within 30 minutes.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="grid gap-4"
    >
      <FormAlert message={formError} />
      <FormField
        label="Email address"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Button type="submit" disabled={isSubmitting}>
        Email me a reset link
      </Button>
    </form>
  );
}
