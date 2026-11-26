"use client";

import { useId, useState } from "react";

import { searchFeatures } from "./features";

const ACCENTS: Readonly<Record<string, string>> = {
  before: "bg-primary text-primary-foreground",
  during: "bg-live text-live-foreground",
  after: "bg-success text-white",
  workspace: "bg-foreground text-background",
};

/** Every feature on one page, searchable (docs/design/learnability.md). */
export function HelpPage() {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const groups = searchFeatures(query);
  const count = groups.reduce((sum, group) => sum + group.features.length, 0);
  return (
    <div className="grid gap-8">
      <div className="grid max-w-3xl gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Everything GoLiveBoard does
        </h1>
        <p className="leading-relaxed text-muted-foreground">
          An online event in three parts: get it ready, run it live, learn from
          it. Each feature says where to find it.
        </p>
        <label htmlFor={searchId} className="mt-3 text-sm font-medium">
          Search the features
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="e.g. webhook, invite, report"
          className="h-11 rounded-lg border border-input bg-background px-3.5"
        />
        <p role="status" className="text-sm text-muted-foreground">
          {query.trim() === ""
            ? ""
            : `${String(count)} ${count === 1 ? "feature" : "features"} found`}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-6">
        {groups.map((group, index) => (
          <section
            key={group.id}
            aria-labelledby={`${group.id}-heading`}
            className="flex min-w-0 flex-[1_1_15rem] flex-col gap-2.5"
          >
            <h2
              id={`${group.id}-heading`}
              className="flex items-center gap-2 text-base font-bold"
            >
              <span
                aria-hidden="true"
                className={`figures flex size-6 items-center justify-center rounded-full text-xs ${ACCENTS[group.id] ?? ""}`}
              >
                {index + 1}
              </span>
              {group.title}
            </h2>
            <ul className="grid gap-2.5">
              {group.features.map((feature) => (
                <li
                  key={feature.name}
                  className="grid gap-1 rounded-xl border bg-card p-3.5"
                >
                  <h3 className="text-sm font-semibold">{feature.name}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {feature.what}
                  </p>
                  <p className="text-xs font-semibold text-primary">
                    {feature.where}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {count === 0 ? (
          <p className="text-muted-foreground">
            Nothing matches. Try another word, or browse with the search empty.
          </p>
        ) : null}
      </div>
    </div>
  );
}
