"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { useMe } from "../shell/me-context";
import { EventFilters } from "./event-filters";
import type { EventListFilters } from "./event-list-filters";
import { EventsTable } from "./events-table";

/** FR-EV-3: the workspace's events, searchable and filterable. */
export function EventsPage() {
  const { role } = useMe().activeWorkspace;
  const [filters, setFilters] = useState<EventListFilters>({});
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        {role === "ANALYST" ? null : (
          <Button asChild>
            <Link href="/events/new">New event</Link>
          </Button>
        )}
      </div>
      <EventFilters onChange={setFilters} />
      <EventsTable filters={filters} />
    </div>
  );
}
