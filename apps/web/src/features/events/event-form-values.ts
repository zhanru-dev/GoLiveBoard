import {
  END_AFTER_START_MESSAGE,
  EventDescription,
  EventTitle,
  EXPECTED_ATTENDANCE_MAX,
  TimeZone,
} from "@opspilot/contracts";
import { z } from "zod";

import { zonedToUtc } from "@/lib/time";

/**
 * What the event form edits. Times are wall-clock values in the event's own
 * zone (as `datetime-local` inputs hold them) and become UTC instants only
 * when sent, so the form shows the event's times wherever the browser is.
 */
export const EventFormValues = z
  .object({
    title: EventTitle,
    description: EventDescription,
    startsLocal: z.string().min(1, { error: "Choose when the event starts" }),
    endsLocal: z.string().min(1, { error: "Choose when the event ends" }),
    timeZone: TimeZone,
    expectedAttendance: z
      .string()
      .regex(/^\d*$/, { error: "Enter a whole number" })
      .refine((value) => value === "" || Number(value) >= 1, {
        error: "Enter at least 1",
      })
      .refine(
        (value) => value === "" || Number(value) <= EXPECTED_ATTENDANCE_MAX,
        {
          error: `Enter at most ${EXPECTED_ATTENDANCE_MAX.toLocaleString("en-GB")}`,
        },
      ),
    /** A member's user ID, or "" for nobody. Only the edit form shows it. */
    ownerUserId: z.string(),
  })
  // Both times are in the same zone, so comparing the wall clocks is enough.
  .refine((values) => values.endsLocal > values.startsLocal, {
    path: ["endsLocal"],
    error: END_AFTER_START_MESSAGE,
  });
export type EventFormValues = z.infer<typeof EventFormValues>;

/** The request body fields the form produces. */
export function toEventFields(values: EventFormValues) {
  return {
    title: values.title,
    description: values.description,
    startsAt: zonedToUtc(values.startsLocal, values.timeZone),
    endsAt: zonedToUtc(values.endsLocal, values.timeZone),
    timeZone: values.timeZone,
    expectedAttendance:
      values.expectedAttendance === ""
        ? null
        : Number(values.expectedAttendance),
  };
}

export const EVENT_FORM_FIELDS = [
  "title",
  "description",
  "startsLocal",
  "endsLocal",
  "timeZone",
  "expectedAttendance",
  "ownerUserId",
] as const satisfies readonly (keyof EventFormValues)[];

/** API field names that the form calls differently. */
export const API_FIELD_TO_FORM = {
  startsAt: "startsLocal",
  endsAt: "endsLocal",
} as const satisfies Readonly<Record<string, keyof EventFormValues>>;
