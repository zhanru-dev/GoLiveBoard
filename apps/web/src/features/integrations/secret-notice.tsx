"use client";

import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * A signing secret, shown this once: the API keeps it encrypted and never
 * returns it again.
 */
export function SecretNotice({
  secret,
  onDone,
}: Readonly<{ secret: string; onDone: () => void }>) {
  return (
    <Alert role="alert">
      <AlertTitle>Copy the signing secret now</AlertTitle>
      <AlertDescription className="grid gap-3">
        <p>
          It is shown only this once. Your receiver uses it to check the
          GoLiveBoard-Signature header of every webhook.
        </p>
        <code className="rounded bg-muted px-2 py-1 font-mono text-sm break-all">
          {secret}
        </code>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(secret).then(
                () => toast.success("Copied"),
                () => toast.error("Could not copy; select the secret instead"),
              );
            }}
          >
            Copy
          </Button>
          <Button variant="ghost" onClick={onDone}>
            I have saved it
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
