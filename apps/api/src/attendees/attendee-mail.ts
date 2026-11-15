import { Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { isDemoWorkspace } from "../demo/demo-workspace.js";
import type { Prisma } from "../generated/prisma/client.js";
import { Mailer, mailDeliveryError, type MailMessage } from "../mail/mailer.js";

/** Demo inbox messages kept per attendee; older ones are deleted. */
export const DEMO_INBOX_PER_ATTENDEE = 10;

/** Who a message is for, as far as delivery cares. */
export interface Recipient {
  readonly attendeeId: string;
  readonly workspaceId: string;
  /** The demo inbox the attendee's mail goes to; demo workspace only. */
  readonly demoInboxKeyHash: string | null;
}

/**
 * Delivers email to attendees. In the demo workspace nothing is sent: the
 * message is kept for the demo inbox of the browser that registered the
 * attendee (FR-AUTH-5), so visitors can register with any address and
 * nobody receives mail they did not ask for.
 */
@Injectable()
export class AttendeeMail {
  constructor(
    private readonly mailer: Mailer,
    @InjectPinoLogger(AttendeeMail.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Call inside the transaction that decided to write the message: a demo
   * message is stored with it. Real mail goes once the caller has committed,
   * through the returned function; it is sent in the background, so how long
   * a request takes never depends on whether it sent mail.
   */
  async prepare(
    tx: Prisma.TransactionClient,
    recipient: Recipient,
    message: MailMessage,
  ): Promise<() => void> {
    if (isDemoWorkspace(recipient.workspaceId)) {
      if (recipient.demoInboxKeyHash !== null) {
        await tx.demoInboxMessage.create({
          data: {
            attendeeId: recipient.attendeeId,
            inboxKeyHash: recipient.demoInboxKeyHash,
            subject: message.subject,
            text: message.text,
          },
        });
        // Bounded however often anyone registers this address: the newest
        // messages are kept. The caller holds the attendee's row lock.
        await tx.$executeRaw`
          DELETE FROM demo_inbox_messages
          WHERE attendee_id = ${recipient.attendeeId}::uuid
            AND id NOT IN (
              SELECT id FROM demo_inbox_messages
              WHERE attendee_id = ${recipient.attendeeId}::uuid
              ORDER BY created_at DESC, id DESC
              LIMIT ${DEMO_INBOX_PER_ATTENDEE}
            )`;
      }
      return () => undefined;
    }
    return () => {
      this.mailer.send(message).catch((error: unknown) => {
        // The address is personal data: logged by attendee only.
        this.logger.error(
          { err: mailDeliveryError(error), attendeeId: recipient.attendeeId },
          "Could not send an email to an attendee",
        );
      });
    };
  }
}
