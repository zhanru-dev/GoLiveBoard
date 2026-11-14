import type { AttendeeMe, PublicEvent } from "@opspilot/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { AttendeePanel } from "@/features/public/attendee-panel";
import { EventTime } from "@/features/public/event-time";
import { PrivacyNotice } from "@/features/public/privacy-notice";
import { RegistrationForm } from "@/features/public/registration-form";
import { getAttendeeMe, getPublicEvent } from "@/lib/server-api";
import { formatInZone } from "@/lib/time";

interface Props {
  readonly params: Promise<{ slug: string }>;
}

/** One request per render, shared by the metadata and the page. */
const loadEvent = cache(getPublicEvent);

/** Link previews (FR-AD-1): title, description and time, in Open Graph. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (event === null) {
    return { title: "Event not found" };
  }
  const when = formatInZone(event.startsAt, event.timeZone);
  const description =
    event.description === "" ? `Online event, ${when}.` : event.description;
  return {
    title: event.title,
    description,
    alternates: { canonical: `/e/${event.slug}` },
    openGraph: {
      type: "website",
      title: event.title,
      description: `${when}. ${description}`,
      url: `/e/${event.slug}`,
      siteName: "OpsPilot",
    },
    twitter: { card: "summary", title: event.title, description },
  };
}

const STATUS_NOTE = {
  UPCOMING: null,
  LIVE: "Happening now.",
  ENDED: "This event has ended.",
  CANCELLED: "This event has been cancelled.",
} as const;

/** The public event page (FR-AD-1), rendered on the server. */
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (event === null) {
    notFound();
  }
  const me = await getAttendeeMe(slug);
  const note = STATUS_NOTE[event.status];
  return (
    <>
      <header className="grid gap-2">
        <p className="text-sm font-medium text-muted-foreground">OpsPilot</p>
        <h1 className="text-3xl font-semibold tracking-tight">{event.title}</h1>
        <EventTime
          startsAt={event.startsAt}
          endsAt={event.endsAt}
          eventTimeZone={event.timeZone}
        />
        {note === null ? null : <p className="font-medium">{note}</p>}
      </header>
      {event.description === "" ? null : (
        <p className="whitespace-pre-wrap">{event.description}</p>
      )}
      <Admission slug={slug} event={event} me={me} />
    </>
  );
}

/** The signed-in attendee's panel, the registration form, or neither. */
function Admission({
  slug,
  event,
  me,
}: Readonly<{ slug: string; event: PublicEvent; me: AttendeeMe | null }>) {
  if (me !== null) {
    return <AttendeePanel slug={slug} me={me} />;
  }
  const { registration } = event;
  if (!registration.open || registration.privacyNoticeVersion === null) {
    return <p>Registration is closed.</p>;
  }
  return (
    <section aria-labelledby="register-heading" className="grid gap-4">
      <h2 id="register-heading" className="text-xl font-semibold">
        Register
      </h2>
      {registration.mode === "INVITE_ONLY" ? (
        <p className="text-sm text-muted-foreground">
          This event is by invitation: register with the address you were
          invited at.
        </p>
      ) : null}
      {registration.mode === "EMAIL_DOMAIN" ? (
        <p className="text-sm text-muted-foreground">
          Open to addresses at {registration.allowedDomains.join(", ")}.
        </p>
      ) : null}
      <PrivacyNotice
        version={registration.privacyNoticeVersion}
        retentionDays={registration.retentionDays}
      />
      <RegistrationForm
        slug={slug}
        privacyNoticeVersion={registration.privacyNoticeVersion}
        demoMode={process.env.DEMO_MODE === "true"}
      />
    </section>
  );
}
