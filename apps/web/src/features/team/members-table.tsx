"use client";

import { Member, type Role } from "@opspilot/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
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
import { api, ApiError } from "@/lib/api";

import { useMe } from "../shell/me-context";
import { ROLE_LABELS, ROLES, teamKeys } from "./roles";

const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? (error.problem.detail ?? error.problem.title)
    : "Something went wrong.";

export function MembersTable() {
  const me = useMe();
  const isOwner = me.activeWorkspace.role === "OWNER";
  const { workspaceId } = me.activeWorkspace;
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: teamKeys.members(workspaceId),
    queryFn: ({ signal }) =>
      api("/workspace/members", {
        schema: z.array(Member),
        workspaceId,
        signal,
      }),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: teamKeys.members(workspaceId) });

  const changeRole = useMutation({
    mutationFn: ({
      membershipId,
      role,
    }: {
      membershipId: string;
      role: Role;
    }) =>
      api(`/workspace/members/${membershipId}`, {
        method: "PATCH",
        body: { role },
        workspaceId,
      }),
    onSuccess: () => toast.success("Role changed"),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (membershipId: string) =>
      api(`/workspace/members/${membershipId}`, {
        method: "DELETE",
        workspaceId,
      }),
    onSuccess: () => toast.success("Member removed"),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });

  if (members.isPending) {
    return <p role="status">Loading members…</p>;
  }
  if (members.isError) {
    return (
      <p role="alert">
        Could not load the members. {errorMessage(members.error)}
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          {isOwner ? <TableHead className="sr-only">Actions</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.data.map((member) => (
          <TableRow key={member.membershipId}>
            <TableCell>{member.name}</TableCell>
            <TableCell>{member.email}</TableCell>
            <TableCell>
              {isOwner ? (
                <Select
                  value={member.role}
                  onValueChange={(role) => {
                    changeRole.mutate({
                      membershipId: member.membershipId,
                      role: role as Role,
                    });
                  }}
                >
                  <SelectTrigger
                    aria-label={`Role of ${member.name}`}
                    className="w-36"
                  >
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
              ) : (
                ROLE_LABELS[member.role]
              )}
            </TableCell>
            {isOwner ? (
              <TableCell className="text-right">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost">Remove</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove {member.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        They lose access to this workspace at once and are
                        signed out of it.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          remove.mutate(member.membershipId);
                        }}
                      >
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
