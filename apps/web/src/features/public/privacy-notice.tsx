/**
 * The privacy notice shown before registering (FR-AD-6). Its version is
 * recorded with the registration.
 */
export function PrivacyNotice({
  version,
  retentionDays,
}: Readonly<{ version: string; retentionDays: number }>) {
  return (
    <details className="rounded-lg border p-4 text-sm">
      <summary className="cursor-pointer font-medium">
        Privacy notice (version {version})
      </summary>
      <div className="mt-3 grid gap-2 text-muted-foreground">
        <p>
          The organiser uses your name and email address to run this event: to
          confirm your registration, let you in, and, if you choose, remind you
          before it starts.
        </p>
        <p>
          Your name and address are deleted or anonymised {retentionDays} days
          after the event ends. You can ask the organiser to erase them sooner,
          and stop reminders at any time with the link in each reminder.
        </p>
        <p>Nothing is shared with anyone else, and nothing is sold.</p>
      </div>
    </details>
  );
}
