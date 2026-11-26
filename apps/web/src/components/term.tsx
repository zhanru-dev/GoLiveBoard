"use client";

import { useId, useState } from "react";

import { GLOSSARY, type GlossaryTerm } from "@/lib/glossary";

/**
 * A term with its definition one press away: a "?" button that shows and
 * hides it, announced with the button (aria-expanded, aria-controls), so
 * it works with a keyboard and a screen reader, and nothing pops over the
 * page.
 */
export function Term({
  term,
  label,
}: Readonly<{ term: GlossaryTerm; label: string }>) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`What is ${label.toLowerCase()}?`}
        onClick={() => {
          setOpen(!open);
        }}
        className="ml-1.5 inline-flex size-5 items-center justify-center rounded-full border border-input/60 align-[2px] text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        ?
      </button>
      <span
        id={id}
        hidden={!open}
        className="mt-2 block basis-full max-w-prose rounded-lg bg-foreground px-3.5 py-2.5 text-sm leading-relaxed font-normal text-background"
      >
        <strong className="font-semibold">{label}:</strong> {GLOSSARY[term]}
      </span>
    </>
  );
}
