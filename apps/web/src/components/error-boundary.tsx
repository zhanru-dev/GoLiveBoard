"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { reportCaughtError } from "@/lib/report-caught-error";

interface Props {
  /** What this part of the page shows, for the message: "the readiness panel". */
  readonly what: string;
  readonly children: ReactNode;
}

interface State {
  readonly failed: boolean;
}

/**
 * Keeps a rendering error in one part of a page to that part: the rest of
 * the page goes on working (a broken readiness panel leaves the runbook
 * usable; a broken chat leaves the video playing). The error is reported,
 * and "Try again" renders the part afresh.
 *
 * Plain markup and buttonVariants only, no Radix: it is used on the public
 * watch page, which has a JavaScript budget (NFR-3).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    reportCaughtError(error);
  }

  private readonly retry = () => {
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <div
        role="alert"
        className="grid justify-items-start gap-2 rounded-lg border border-destructive/50 p-4 text-sm"
      >
        <p className="font-medium">
          Something went wrong showing {this.props.what}.
        </p>
        <p className="text-muted-foreground">
          The rest of the page still works. If this keeps happening, reload the
          page.
        </p>
        <button
          type="button"
          className={buttonVariants({ variant: "outline", size: "sm" })}
          onClick={this.retry}
        >
          Try again
        </button>
      </div>
    );
  }
}
