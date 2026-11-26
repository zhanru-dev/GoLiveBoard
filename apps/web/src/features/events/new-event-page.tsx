"use client";

import { EventDetail } from "@goliveboard/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api";

import { useMe } from "../shell/me-context";
import { EventForm } from "./event-form";
import { toEventFields } from "./event-form-values";
import { eventKeys } from "./event-keys";

/** Tomorrow at the given hour, as a datetime-local value. */
function tomorrowAt(hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour)}:00`;
}

export function NewEventPage() {
  const { workspaceId } = useMe().activeWorkspace;
  const router = useRouter();
  const queryClient = useQueryClient();
  // One key for this form: if the response is lost and the user submits
  // again, the API returns the event it already created (NFR-5).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const create = useMutation({
    mutationFn: (body: object) =>
      api("/events", {
        method: "POST",
        body,
        schema: EventDetail,
        workspaceId,
        idempotencyKey,
      }),
  });

  return (
    <div className="grid max-w-2xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">New event</h1>
      <EventForm
        submitLabel="Create event"
        defaultValues={{
          title: "",
          description: "",
          startsLocal: tomorrowAt(18),
          startsOccurrence: "",
          endsLocal: tomorrowAt(19),
          endsOccurrence: "",
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          expectedAttendance: "",
          ownerUserId: "",
        }}
        onSubmit={async (values) => {
          const event = await create.mutateAsync(toEventFields(values));
          await queryClient.invalidateQueries({
            queryKey: eventKeys.all(workspaceId),
          });
          router.push(`/events/${event.id}`);
        }}
      />
    </div>
  );
}
