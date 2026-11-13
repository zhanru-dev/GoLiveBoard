"use client";

import type { EventStatus } from "@opspilot/contracts";
import { type SubmitEvent, useState } from "react";

import { FormField } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";

import type { EventListFilters } from "./event-list-filters";
import { STATUS_LABELS, STATUSES } from "./event-status";

/** Search applies on submit, so typing does not send a request per key. */
export function EventFilters({
  onChange,
}: Readonly<{ onChange: (filters: EventListFilters) => void }>) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<EventStatus | "">("");

  function apply(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = q.trim();
    onChange({
      ...(search === "" ? {} : { q: search }),
      ...(status === "" ? {} : { status }),
    });
  }

  return (
    <form
      role="search"
      onSubmit={apply}
      className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
    >
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
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  );
}
