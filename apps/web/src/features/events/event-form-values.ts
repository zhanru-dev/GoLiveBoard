import {
  END_AFTER_START_MESSAGE,
  EventDescription,
  EventTitle,
  EXPECTED_ATTENDANCE_MAX,
  TimeZone,
} from "@goliveboard/contracts";
import { z } from "zod";

import { resolveZonedTime, utcToZoned } from "@/lib/time";

/**
 * Which of two instants a repeated wall-clock time means (the clocks went
 * back); "" when the time happens only once.
 */
export const OccurrenceChoice = z.enum(["", "earlier", "later"]);
export type OccurrenceChoice = z.infer<typeof OccurrenceChoice>;

/**
 * The UTC instant a wall-clock time and choice stand for, or a reason it
 * stands for none.
 */
export function instantFor(
  local: string,
  occurrence: OccurrenceChoice,
  timeZone: string,
): { utc: string } | { problem: string } {
  const resolved = resolveZonedTime(local, timeZone);
  switch (resolved.kind) {
    case "exact":
      return { utc: resolved.utc };
    case "missing":
      return {
        problem: `This time does not exist in ${timeZone}: the clocks go forward over it.`,
      };
    case "ambiguous":
      if (occurrence === "") {
        return {
          problem: `This time happens twice in ${timeZone}, because the clocks go back. Choose which one you mean.`,
        };
      }
      return {
        utc: occurrence === "earlier" ? resolved.earlier : resolved.later,
      };
    default:
      return resolved satisfies never;
  }
}

/** The form's view of a stored instant: its wall clock and, if repeated, which one. */
export function timeFieldsFor(
  utc: string,
  timeZone: string,
): { local: string; occurrence: OccurrenceChoice } {
  const local = utcToZoned(utc, timeZone);
  const resolved = resolveZonedTime(local, timeZone);
  if (resolved.kind !== "ambiguous") {
    return { local, occurrence: "" };
  }
  return { local, occurrence: resolved.earlier === utc ? "earlier" : "later" };
}

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
    startsOccurrence: OccurrenceChoice,
    endsLocal: z.string().min(1, { error: "Choose when the event ends" }),
    endsOccurrence: OccurrenceChoice,
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
  .superRefine((values, context) => {
    const starts = instantFor(
      values.startsLocal,
      values.startsOccurrence,
      values.timeZone,
    );
    const ends = instantFor(
      values.endsLocal,
      values.endsOccurrence,
      values.timeZone,
    );
    if ("problem" in starts) {
      context.addIssue({
        code: "custom",
        path: ["startsLocal"],
        message: starts.problem,
      });
    }
    if ("problem" in ends) {
      context.addIssue({
        code: "custom",
        path: ["endsLocal"],
        message: ends.problem,
      });
    }
    if ("utc" in starts && "utc" in ends && ends.utc <= starts.utc) {
      context.addIssue({
        code: "custom",
        path: ["endsLocal"],
        message: END_AFTER_START_MESSAGE,
      });
    }
  });
export type EventFormValues = z.infer<typeof EventFormValues>;

/** The instant of a validated time field (the schema ruled out problems). */
function validInstant(
  local: string,
  occurrence: OccurrenceChoice,
  timeZone: string,
) {
  const instant = instantFor(local, occurrence, timeZone);
  if ("problem" in instant) {
    throw new Error(instant.problem);
  }
  return instant.utc;
}

/** Every request body field the form produces (creating an event). */
export function toEventFields(values: EventFormValues) {
  return {
    title: values.title,
    description: values.description,
    startsAt: validInstant(
      values.startsLocal,
      values.startsOccurrence,
      values.timeZone,
    ),
    endsAt: validInstant(
      values.endsLocal,
      values.endsOccurrence,
      values.timeZone,
    ),
    timeZone: values.timeZone,
    expectedAttendance:
      values.expectedAttendance === ""
        ? null
        : Number(values.expectedAttendance),
  };
}

/**
 * Only the fields that changed (editing an event). A time that was not
 * touched is not sent again: converting it back from the wall clock could
 * move it, for example to the other 01:30 of a night when the clocks go back.
 */
export function changedEventFields(
  values: EventFormValues,
  original: EventFormValues,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  const all = {
    ...toEventFields(values),
    ownerUserId: values.ownerUserId === "" ? null : values.ownerUserId,
  };
  const before = {
    ...toEventFields(original),
    ownerUserId: original.ownerUserId === "" ? null : original.ownerUserId,
  };
  for (const [field, value] of Object.entries(all)) {
    if (value !== before[field as keyof typeof before]) {
      changes[field] = value;
    }
  }
  return changes;
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
