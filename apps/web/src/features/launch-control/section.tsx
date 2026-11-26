import type { ReactNode } from "react";

/**
 * One Launch Control section. Its id is the anchor that readiness next
 * actions link to (ReadinessSection, lower-case with hyphens).
 */
export function Section({
  id,
  title,
  children,
}: Readonly<{ id: string; title: string; children: ReactNode }>) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="grid scroll-mt-6 gap-4 rounded-2xl border bg-card p-5 sm:p-6"
    >
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
