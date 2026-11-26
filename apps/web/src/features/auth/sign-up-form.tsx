"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PASSWORD_MIN_LENGTH, SignUpRequest } from "@goliveboard/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";
import { APP_HOME } from "@/lib/safe-next";

export function SignUpForm() {
  const router = useRouter();
  const [formError, setFormError] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignUpRequest>({ resolver: zodResolver(SignUpRequest) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      await api("/auth/sign-up", { method: "POST", body: values });
    } catch (error) {
      setFormError(
        applyApiError(error, setError, ["name", "email", "password"]),
      );
      return;
    }
    // Sign-up answers the same for new and registered addresses, so try
    // signing in: it works for a new account. For an existing account the
    // owner has just been emailed instead.
    try {
      await api("/auth/sign-in", {
        method: "POST",
        body: { email: values.email, password: values.password },
      });
      router.replace(APP_HOME);
      router.refresh();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.problem.code === "CREDENTIALS_INVALID"
      ) {
        setCheckEmail(true);
        return;
      }
      setFormError(applyApiError(error, setError, []));
    }
  });

  if (checkEmail) {
    return (
      <Alert>
        <AlertDescription>
          Check your inbox: we have emailed you. If you already have an account,{" "}
          <Link href="/sign-in" className="underline underline-offset-4">
            sign in
          </Link>{" "}
          instead.
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
        label="Your name"
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
      <FormField
        label="Password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${String(PASSWORD_MIN_LENGTH)} characters. A few unrelated words make a strong password.`}
        error={errors.password?.message}
        {...register("password")}
      />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Creating your workspace…" : "Create account"}
      </Button>
      <p className="text-sm">
        Already have an account?{" "}
        <Link href="/sign-in" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
