import type { Question } from "@goliveboard/contracts";

/** A question's written answer, as everyone who sees the question sees it. */
export function WrittenAnswer({
  answer,
}: Readonly<{ answer: NonNullable<Question["answer"]> }>) {
  return (
    <div className="grid gap-0.5 rounded-md bg-muted px-3 py-2">
      <p className="text-xs font-semibold text-muted-foreground">
        Answer from the team
      </p>
      <p className="whitespace-pre-wrap">{answer.body}</p>
    </div>
  );
}
