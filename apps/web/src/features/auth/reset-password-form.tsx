"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Password, PASSWORD_MIN_LENGTH } from "@opspilot/contracts";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";

import { useLinkToken } from "./use-link-token";

const NewPassword = z.object({ password: Password });
type NewPassword = z.infer<typeof NewPassword>;

export function ResetPasswordForm() {
  const token = useLinkToken();
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewPassword>({ resolver: zodResolver(NewPassword) });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError("");
    try {
      await api("/auth/password-reset/confirm", {
        method: "POST",
        body: { token, password },
      });
      setDone(true);
    } catch (error) {
      setFormError(applyApiError(error, setError, ["password"]));
    }
  });

  if (done) {
    return (
      <Alert role="status">
        <AlertDescription>
          Your password has been changed and you have been signed out
          everywhere.{" "}
          <Link href="/sign-in" className="underline underline-offset-4">
            Sign in
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form
      method="post"
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="grid gap-4"
    >
      <FormAlert message={formError} />
      <FormField
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${String(PASSWORD_MIN_LENGTH)} characters.`}
        error={errors.password?.message}
        {...register("password")}
      />
      <Button type="submit" disabled={isSubmitting || token === ""}>
        Set new password
      </Button>
    </form>
  );
}
