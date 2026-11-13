"use client";

import { EventDetail, Member } from "@opspilot/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { api } from "@/lib/api";
import { utcToZoned } from "@/lib/time";

import { EventForm } from "../events/event-form";
import { toEventFields } from "../events/event-form-values";
import { teamKeys } from "../team/roles";
import { Section } from "./section";
import type { LaunchControl } from "./use-launch-control";

/** FR-EV-1: editing the event, based on the version that was loaded. */
export function DetailsSection({
  control,
  event,
}: Readonly<{ control: LaunchControl; event: EventDetail }>) {
  const { workspaceId } = control;
  const members = useQuery({
    queryKey: teamKeys.members(workspaceId),
    queryFn: ({ signal }) =>
      api("/workspace/members", {
        schema: z.array(Member),
        workspaceId,
        signal,
      }),
  });
  const save = useMutation({
    mutationFn: (body: object) =>
      api(`/events/${event.id}`, {
        method: "PATCH",
        body,
        ifMatch: event.version,
        schema: EventDetail,
        workspaceId,
      }),
    onSuccess: () => toast.success("Event details saved"),
    // On a conflict too, so the form shows what is stored now.
    onSettled: () => control.refresh(),
  });

  return (
    <Section id="details" title="Details">
      <EventForm
        // Saving bumps the version, which resets the form to what is stored.
        key={event.version}
        submitLabel="Save details"
        disabled={!control.canEdit}
        owners={
          members.data?.map((member) => ({
            userId: member.userId,
            name: member.name,
          })) ?? []
        }
        defaultValues={{
          title: event.title,
          description: event.description,
          startsLocal: utcToZoned(event.startsAt, event.timeZone),
          endsLocal: utcToZoned(event.endsAt, event.timeZone),
          timeZone: event.timeZone,
          expectedAttendance:
            event.expectedAttendance === null
              ? ""
              : String(event.expectedAttendance),
          ownerUserId: event.owner?.userId ?? "",
        }}
        onSubmit={async (values) => {
          await save.mutateAsync({
            ...toEventFields(values),
            ownerUserId: values.ownerUserId === "" ? null : values.ownerUserId,
          });
        }}
      />
    </Section>
  );
}
