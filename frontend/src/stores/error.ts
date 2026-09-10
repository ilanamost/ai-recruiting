// Shared by the stores: the exact `err instanceof Error ? err.message : '<fallback>'` shape the
// five migrated components used inline before .plan/018 moved their error handling in here. The
// fallback strings are copied verbatim from those components — see each store's call sites.
export function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}
