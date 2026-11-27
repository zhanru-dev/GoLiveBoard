import type { Poll } from "@goliveboard/contracts";

/** A whole percentage of the answers; 0 when nobody has answered. */
export function percentOf(votes: number, total: number): number {
  return total === 0 ? 0 : Math.round((votes / total) * 100);
}

/**
 * A poll's counts as bars (FR-RN-8). The bars are drawn, and hidden from
 * assistive technology: each option's words say the same.
 */
export function PollResults({ poll }: Readonly<{ poll: Poll }>) {
  return (
    <div className="grid gap-2">
      <ul className="grid gap-2">
        {poll.options.map((option) => {
          const percent = percentOf(option.votes, poll.totalVotes);
          return (
            <li key={option.id} className="grid gap-1 text-sm">
              <span className="flex justify-between gap-3">
                <span>
                  {option.label}
                  {poll.myOptionId === option.id ? " · Your answer" : ""}
                </span>
                <span className="figures text-muted-foreground">
                  {percent}% ({option.votes})
                </span>
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 100 4"
                preserveAspectRatio="none"
                className="h-1.5 w-full"
              >
                <rect width={100} height={4} rx={2} className="fill-muted" />
                <rect
                  width={percent}
                  height={4}
                  rx={2}
                  className="fill-primary"
                />
              </svg>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        {poll.totalVotes} {poll.totalVotes === 1 ? "answer" : "answers"}
        {poll.status === "CLOSED" ? " · Closed" : ""}
      </p>
    </div>
  );
}
