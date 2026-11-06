/** Minimal server-side authorization seam. Replace with trusted identity-provider data. */
export type Membership = { userId: string; organisationId: string; role: "owner" | "admin" | "bookkeeper" | "accountant"; active: boolean };

export async function requireOrganisationAccess(
  userId: string,
  organisationId: string,
  loadMembership: (userId: string, organisationId: string) => Promise<Membership | null>,
): Promise<Membership> {
  const membership = await loadMembership(userId, organisationId);
  if (!membership || !membership.active || membership.userId !== userId || membership.organisationId !== organisationId) {
    throw new Error("Forbidden");
  }
  return membership;
}
