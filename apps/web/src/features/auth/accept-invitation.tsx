"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  InvitationPreview,
  PASSWORD_MIN_LENGTH,
  Password,
  PersonName,
} from "@opspilot/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";

import { useLinkToken } from "./use-link-token";

const NewAccount = z.object({ name: PersonName, password: Password });
type NewAccount = z.infer<typeof NewAccount>;

const ROLE_LABELS = {
  OWNER: "Owner",
  MANAGER: "Manager",
  ANALYST: "Analyst",
} as const;

export function AcceptInvitation() {
  const token = useLinkToken();
  const preview = useQuery({
    queryKey: ["invitation-preview", token],
    enabled: token !== "",
    queryFn: () =>
      api("/team-invitations/preview", {
        method: "POST",
        body: { token },
        schema: InvitationPreview,
      }),
  });
  const [accepted, setAccepted] = useState(false);

  if (token === "" || preview.isError) {
    const expired =
      preview.error instanceof ApiError &&
      preview.error.problem.code === "TOKEN_INVALID";
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>
          {expired || token === ""
            ? "This invitation link is invalid, has expired or has already been used. Ask the workspace Owner for a new one."
            : "We could not load this invitation. Please try again."}
        </AlertDescription>
      </Alert>
    );
  }
  if (preview.data === undefined) {
    return <p role="status">Loading the invitation…</p>;
  }
  if (accepted) {
    return (
      <Alert role="status">
        <AlertDescription>
          You have joined {preview.data.workspaceName}.{" "}
          <Link href="/sign-in" className="underline underline-offset-4">
            Sign in
          </Link>{" "}
          to continue.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="grid gap-4">
      <p>
        You have been invited to join{" "}
        <strong>{preview.data.workspaceName}</strong> as{" "}
        {ROLE_LABELS[preview.data.role]}, with the address {preview.data.email}.
      </p>
      {preview.data.accountExists ? (
        <JoinExisting
          token={token}
          onAccepted={() => {
            setAccepted(true);
          }}
        />
      ) : (
        <CreateAccount
          token={token}
          onAccepted={() => {
            setAccepted(true);
          }}
        />
      )}
    </div>
  );
}

interface StepProps {
  readonly token: string;
  readonly onAccepted: () => void;
}

function JoinExisting({ token, onAccepted }: StepProps) {
  const accept = useMutation({
    mutationFn: () =>
      api("/team-invitations/accept", { method: "POST", body: { token } }),
    onSuccess: onAccepted,
  });
  return (
    <>
      {accept.isError ? <FormAlert message={accept.error.message} /> : null}
      <Button
        onClick={() => {
          accept.mutate();
        }}
        disabled={accept.isPending}
      >
        Join workspace
      </Button>
    </>
  );
}

function CreateAccount({ token, onAccepted }: StepProps) {
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewAccount>({ resolver: zodResolver(NewAccount) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      await api("/team-invitations/accept", {
        method: "POST",
        body: { token, ...values },
      });
      onAccepted();
    } catch (error) {
      setFormError(applyApiError(error, setError, ["name", "password"]));
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
        label="Your name"
        autoComplete="name"
        error={errors.name?.message}
        {...register("name")}
      />
      <FormField
        label="Choose a password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${String(PASSWORD_MIN_LENGTH)} characters.`}
        error={errors.password?.message}
        {...register("password")}
      />
      <Button type="submit" disabled={isSubmitting}>
        Create account and join
      </Button>
    </form>
  );
}
