"use client";

import type { EventStatus } from "@goliveboard/contracts";
import { type SubmitEvent, useState } from "react";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";

import { dayRange, type EventListFilters } from "./event-list-filters";
import { STATUS_LABELS, STATUSES } from "./event-status";

/** Search applies on submit, so typing does not send a request per key. */
export function EventFilters({
  onChange,
}: Readonly<{ onChange: (filters: EventListFilters) => void }>) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<EventStatus | "">("");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [error, setError] = useState("");

  function apply(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (fromDay !== "" && toDay !== "" && toDay < fromDay) {
      setError("The last day must not be before the first.");
      return;
    }
    const search = q.trim();
    onChange({
      ...(search === "" ? {} : { q: search }),
      ...(status === "" ? {} : { status }),
      ...dayRange(fromDay, toDay),
    });
  }

  return (
    <form
      role="search"
      onSubmit={apply}
      className="grid gap-4 sm:grid-cols-[1fr_10rem_9rem_9rem_auto] sm:items-end"
    >
      <div className="sm:col-span-5">
        <FormAlert message={error} />
      </div>
      <FormField
        label="Search titles"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
        }}
      />
      <NativeSelect
        label="Status"
        value={status}
        onChange={(event) => {
          setStatus(event.target.value as EventStatus | "");
        }}
      >
        <option value="">All statuses</option>
        {STATUSES.map((value) => (
          <option key={value} value={value}>
            {STATUS_LABELS[value]}
          </option>
        ))}
      </NativeSelect>
      <FormField
        label="Starting from"
        type="date"
        value={fromDay}
        onChange={(event) => {
          setFromDay(event.target.value);
        }}
      />
      <FormField
        label="Until"
        type="date"
        value={toDay}
        onChange={(event) => {
          setToDay(event.target.value);
        }}
      />
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  );
}
