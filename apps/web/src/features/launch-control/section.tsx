import type { ReactNode } from "react";

import { Term } from "@/components/term";
import type { GlossaryTerm } from "@/lib/glossary";

/**
 * One Launch Control section. Its id is the anchor that readiness next
 * actions link to (ReadinessSection, lower-case with hyphens). It opens
 * with why it matters (docs/design/learnability.md), and can explain the
 * term it is named after.
 */
export function Section({
  id,
  title,
  description,
  term,
  children,
}: Readonly<{
  id: string;
  title: string;
  description?: string;
  term?: GlossaryTerm;
  children: ReactNode;
}>) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="grid scroll-mt-6 gap-4 rounded-2xl border bg-card p-5 sm:p-6"
    >
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center">
          <h2 id={`${id}-heading`} className="text-lg font-semibold">
            {title}
          </h2>
          {term === undefined ? null : <Term term={term} label={title} />}
        </div>
        {description === undefined ? null : (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}
