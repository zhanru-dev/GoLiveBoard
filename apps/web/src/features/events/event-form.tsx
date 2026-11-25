"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { EventOwner } from "@opspilot/contracts";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { FormTextarea } from "@/components/form-textarea";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { applyApiError } from "@/lib/form-errors";
import { timeZones } from "@/lib/time";

import {
  API_FIELD_TO_FORM,
  EVENT_FORM_FIELDS,
  EventFormValues,
} from "./event-form-values";
import { OccurrenceChoiceField } from "./occurrence-choice";

interface EventFormProps {
  readonly defaultValues: EventFormValues;
  readonly submitLabel: string;
  readonly onSubmit: (values: EventFormValues) => Promise<void>;
  /** Shows the owner picker (editing); creating leaves the owner empty. */
  readonly owners?: readonly EventOwner[];
  readonly disabled?: boolean;
}

/** The event's details, used to create an event and to edit one. */
export function EventForm({
  defaultValues,
  submitLabel,
  onSubmit,
  owners,
  disabled = false,
}: EventFormProps) {
  const zones = useMemo(() => timeZones(), []);
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<EventFormValues>({
    resolver: zodResolver(EventFormValues),
    defaultValues,
  });

  const [startsLocal, endsLocal, timeZone] = useWatch({
    control,
    name: ["startsLocal", "endsLocal", "timeZone"],
  });

  const submit = handleSubmit(async (values) => {
    setFormError("");
    try {
      await onSubmit(values);
    } catch (error) {
      setFormError(
        applyApiError(error, setError, EVENT_FORM_FIELDS, API_FIELD_TO_FORM),
      );
    }
  });

  return (
    <form
      method="post"
      onSubmit={(event) => void submit(event)}
      noValidate
      className="grid gap-4"
    >
      <FormAlert message={formError} />
      <fieldset disabled={disabled} className="grid gap-4">
        <FormField
          label="Title"
          error={errors.title?.message}
          {...register("title")}
        />
        <FormTextarea
          label="Description"
          hint="Shown to attendees on the event page."
          error={errors.description?.message}
          {...register("description")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Starts"
            type="datetime-local"
            error={errors.startsLocal?.message}
            {...register("startsLocal")}
          />
          <FormField
            label="Ends"
            type="datetime-local"
            error={errors.endsLocal?.message}
            {...register("endsLocal")}
          />
          <OccurrenceChoiceField
            label="Starts"
            local={startsLocal}
            timeZone={timeZone}
            registration={register("startsOccurrence")}
          />
          <OccurrenceChoiceField
            label="Ends"
            local={endsLocal}
            timeZone={timeZone}
            registration={register("endsOccurrence")}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <NativeSelect
            label="Time zone"
            error={errors.timeZone?.message}
            {...register("timeZone")}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </NativeSelect>
          <FormField
            label="Expected attendance"
            inputMode="numeric"
            error={errors.expectedAttendance?.message}
            {...register("expectedAttendance")}
          />
        </div>
        {owners === undefined ? null : (
          <NativeSelect
            label="Owner"
            error={errors.ownerUserId?.message}
            {...register("ownerUserId")}
          >
            <option value="">Nobody yet</option>
            {owners.map((owner) => (
              <option key={owner.userId} value={owner.userId}>
                {owner.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <Button
          type="submit"
          disabled={isSubmitting}
          className="justify-self-start"
        >
          {submitLabel}
        </Button>
      </fieldset>
    </form>
  );
}
