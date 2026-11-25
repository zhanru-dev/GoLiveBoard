import type { Prisma } from "../generated/prisma/client.js";
import { DomainError } from "../shared/domain/domain-error.js";

/**
 * People assigned to things (event owners, task owners) must belong to the
 * workspace; anyone else is reported as a field error, without saying whether
 * the user exists at all.
 *
 * @param field - the request field that named the user, for the error
 */
export async function assertWorkspaceMember(
  client: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  field: string,
): Promise<void> {
  const membership = await client.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true },
  });
  if (membership === null) {
    throw new DomainError("VALIDATION_FAILED", {
      errors: [
        {
          path: field,
          code: "not_a_member",
          message: "Choose a member of this workspace.",
        },
      ],
    });
  }
}
