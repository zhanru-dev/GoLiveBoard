"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { SignInRequest } from "@goliveboard/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";
import { safeNext } from "@/lib/safe-next";

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignInRequest>({ resolver: zodResolver(SignInRequest) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      await api("/auth/sign-in", { method: "POST", body: values });
      router.replace(safeNext(searchParams.get("next")));
      router.refresh();
    } catch (error) {
      setFormError(applyApiError(error, setError, ["email", "password"]));
    }
  });

  return (
    <form
      method="post"
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
      <FormField
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="underline underline-offset-4">
          Forgotten your password?
        </Link>
        <Link href="/sign-up" className="underline underline-offset-4">
          Create an account
        </Link>
      </div>
    </form>
  );
}
