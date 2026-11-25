"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreateInvitationRequest, Invitation } from "@opspilot/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";

import { useMe } from "../shell/me-context";

import { ROLE_LABELS, ROLES, teamKeys } from "./roles";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export function InviteForm() {
  const { workspaceId } = useMe().activeWorkspace;
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState("");
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvitationRequest>({
    resolver: zodResolver(CreateInvitationRequest),
    defaultValues: { email: "", role: "ANALYST" },
  });

  // A mutation, so its errors also reach the query client's global handler
  // (a workspace switched in another tab reloads the page).
  const send = useMutation({
    mutationFn: (values: CreateInvitationRequest) =>
      api("/workspace/invitations", {
        method: "POST",
        body: values,
        schema: Invitation,
        workspaceId,
      }),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      await send.mutateAsync(values);
      toast.success(`Invitation sent to ${values.email}`);
      reset();
      await queryClient.invalidateQueries({
        queryKey: teamKeys.invitations(workspaceId),
      });
    } catch (error) {
      setFormError(applyApiError(error, setError, ["email", "role"]));
    }
  });

  return (
    <form
      method="post"
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="grid gap-4 sm:grid-cols-[1fr_10rem_auto] sm:items-start"
    >
      <div className="sm:col-span-3">
        <FormAlert message={formError} />
      </div>
      <FormField
        label="Email address"
        type="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <div className="grid gap-2">
        <Label htmlFor="invite-role">Role</Label>
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(role) => {
                field.onChange(role);
              }}
            >
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <Button
        type="submit"
        disabled={isSubmitting}
        className="sm:mt-[1.375rem]"
      >
        Send invitation
      </Button>
    </form>
  );
}

export function PendingInvitations() {
  const { workspaceId } = useMe().activeWorkspace;
  const queryClient = useQueryClient();
  const invitations = useQuery({
    queryKey: teamKeys.invitations(workspaceId),
    queryFn: ({ signal }) =>
      api("/workspace/invitations", {
        schema: z.array(Invitation),
        workspaceId,
        signal,
      }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/workspace/invitations/${id}`, { method: "DELETE", workspaceId }),
    onSuccess: () => toast.success("Invitation revoked"),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: teamKeys.invitations(workspaceId),
      }),
  });

  if (invitations.isPending) {
    return <p role="status">Loading invitations…</p>;
  }
  if (invitations.isError) {
    return <p role="alert">Could not load the invitations.</p>;
  }
  if (invitations.data.length === 0) {
    return <p className="text-muted-foreground">No pending invitations.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead className="sr-only">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invitations.data.map((invitation) => (
          <TableRow key={invitation.id}>
            <TableCell>{invitation.email}</TableCell>
            <TableCell>{ROLE_LABELS[invitation.role]}</TableCell>
            <TableCell>
              {dateFormat.format(new Date(invitation.expiresAt))}
            </TableCell>
            <TableCell className="text-right">
              <Button
                variant="ghost"
                onClick={() => {
                  revoke.mutate(invitation.id);
                }}
              >
                Revoke
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
