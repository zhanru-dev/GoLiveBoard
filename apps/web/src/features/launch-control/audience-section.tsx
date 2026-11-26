"use client";

import {
  AttendeeInvitation,
  AttendeePage,
  type AttendeeStatus,
  type EventDetail,
  type StaffAttendee,
} from "@goliveboard/contracts";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type SyntheticEvent, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { FormField } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { formatInZone } from "@/lib/time";

import { eventKeys } from "../events/event-keys";
import { useMe } from "../shell/me-context";
import { Section } from "./section";
import type { LaunchControl } from "./use-launch-control";

const STATUS_LABELS: Record<AttendeeStatus, string> = {
  PENDING: "Unverified",
  VERIFIED: "Verified",
  REVOKED: "Revoked",
  ERASED: "Erased",
};

const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? (error.problem.detail ?? error.problem.title)
    : "Something went wrong.";

/**
 * Who registered (docs/04, section 3.4), with revoking and erasing, and the
 * invitations of an invitation-only event (FR-AD-4).
 */
export function AudienceSection({
  control,
  event,
}: Readonly<{ control: LaunchControl; event: EventDetail }>) {
  const { role } = useMe().activeWorkspace;
  const isManager = role !== "ANALYST";
  return (
    <Section
      id="audience"
      title="Audience"
      description="Who has registered, and whether they have confirmed their address. Revoke access or erase someone on request."
    >
      <p className="text-sm text-muted-foreground">
        Public page:{" "}
        <a className="underline" href={`/e/${event.slug}`}>
          /e/{event.slug}
        </a>
      </p>
      <AttendeeList control={control} event={event} isManager={isManager} />
      {isManager ? <Invitations control={control} event={event} /> : null}
    </Section>
  );
}

function AttendeeList({
  control,
  event,
  isManager,
}: Readonly<{
  control: LaunchControl;
  event: EventDetail;
  isManager: boolean;
}>) {
  const { workspaceId } = control;
  const [status, setStatus] = useState<AttendeeStatus | "">("");
  const queryClient = useQueryClient();
  const attendees = useInfiniteQuery({
    queryKey: eventKeys.attendees(workspaceId, event.id, status),
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => {
      const query = new URLSearchParams({ limit: "25" });
      if (status !== "") {
        query.set("status", status);
      }
      if (pageParam !== "") {
        query.set("cursor", pageParam);
      }
      return api(`/events/${event.id}/attendees?${query.toString()}`, {
        schema: AttendeePage,
        workspaceId,
        signal,
      });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: [...eventKeys.detail(workspaceId, event.id), "attendees"],
    });
  const act = useMutation({
    mutationFn: ({
      attendee,
      action,
    }: {
      attendee: StaffAttendee;
      action: "revoke" | "erase";
    }) =>
      api(`/events/${event.id}/attendees/${attendee.id}/${action}`, {
        method: "POST",
        workspaceId,
      }),
    onSuccess: (_result, { action }) =>
      toast.success(action === "revoke" ? "Access revoked" : "Attendee erased"),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });

  const rows = attendees.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="grid gap-3">
      <div className="max-w-56">
        <NativeSelect
          label="Show"
          value={status}
          onChange={(change) => {
            setStatus(change.target.value as AttendeeStatus | "");
          }}
        >
          <option value="">Everyone</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {attendees.isPending ? <p role="status">Loading attendees…</p> : null}
      {attendees.isError ? (
        <p role="alert">
          Could not load the attendees. {errorMessage(attendees.error)}
        </p>
      ) : null}
      {attendees.isSuccess && rows.length === 0 ? <p>Nobody yet.</p> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Registered</TableHead>
                {isManager ? (
                  <TableHead className="sr-only">Actions</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((attendee) => (
                <TableRow key={attendee.id}>
                  <TableCell>{attendee.name}</TableCell>
                  <TableCell>{attendee.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {STATUS_LABELS[attendee.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {formatInZone(attendee.registeredAt, event.timeZone)}
                  </TableCell>
                  {isManager ? (
                    <TableCell className="text-right whitespace-nowrap">
                      {attendee.status === "PENDING" ||
                      attendee.status === "VERIFIED" ? (
                        <Confirm
                          label="Revoke"
                          title={`Revoke ${attendee.name}'s access?`}
                          description="They are signed out of the event at once and cannot register again with this address."
                          disabled={!control.canEdit}
                          onConfirm={() => {
                            act.mutate({ attendee, action: "revoke" });
                          }}
                        />
                      ) : null}
                      {attendee.status === "ERASED" ? null : (
                        <Confirm
                          label="Erase"
                          title={`Erase ${attendee.name}?`}
                          description="Their name and address are anonymised now, for good (UK GDPR erasure). This cannot be undone."
                          onConfirm={() => {
                            act.mutate({ attendee, action: "erase" });
                          }}
                        />
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {attendees.hasNextPage ? (
        <div>
          <Button
            variant="outline"
            disabled={attendees.isFetchingNextPage}
            onClick={() => void attendees.fetchNextPage()}
          >
            Show more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Invitations({
  control,
  event,
}: Readonly<{ control: LaunchControl; event: EventDetail }>) {
  const { workspaceId } = control;
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const key = eventKeys.invitations(workspaceId, event.id);
  const invitations = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api(`/events/${event.id}/invitations`, {
        schema: z.array(AttendeeInvitation),
        workspaceId,
        signal,
      }),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({
      queryKey: [...eventKeys.detail(workspaceId, event.id), "attendees"],
    });
  };
  const invite = useMutation({
    mutationFn: (address: string) =>
      api(`/events/${event.id}/invitations`, {
        method: "POST",
        body: { email: address },
        schema: AttendeeInvitation,
        workspaceId,
      }),
    onSuccess: () => {
      setEmail("");
      toast.success("Invitation sent");
    },
    onError: (failure) => {
      setError(errorMessage(failure));
    },
    onSettled: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/event-invitations/${id}`, { method: "DELETE", workspaceId }),
    onSuccess: () => toast.success("Invitation revoked"),
    onError: (failure) => toast.error(errorMessage(failure)),
    onSettled: refresh,
  });

  function submit(form: SyntheticEvent) {
    form.preventDefault();
    setError(undefined);
    invite.mutate(email);
  }

  return (
    <div className="grid gap-3">
      <h3 className="font-medium">Invitations</h3>
      <p className="text-sm text-muted-foreground">
        For an invitation-only event: only invited addresses can register.
        Revoking an invitation also revokes whoever registered with it.
      </p>
      {control.canEdit ? (
        <form
          method="post"
          onSubmit={submit}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="min-w-64 grow">
            <FormField
              label="Invite by email"
              type="email"
              value={email}
              error={error}
              onChange={(change) => {
                setEmail(change.target.value);
              }}
            />
          </div>
          <Button type="submit" disabled={invite.isPending || email === ""}>
            Invite
          </Button>
        </form>
      ) : null}
      {invitations.isSuccess && invitations.data.length > 0 ? (
        <ul className="grid gap-2" aria-label="Invited addresses">
          {invitations.data.map((invitation) => (
            <li
              key={invitation.id}
              className="flex items-center justify-between gap-2"
            >
              <span>{invitation.email}</span>
              {control.canEdit ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    revoke.mutate(invitation.id);
                  }}
                >
                  Revoke invitation
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Confirm({
  label,
  title,
  description,
  disabled = false,
  onConfirm,
}: Readonly<{
  label: string;
  title: string;
  description: string;
  disabled?: boolean;
  onConfirm: () => void;
}>) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" disabled={disabled}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
