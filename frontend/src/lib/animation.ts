// Per-card entrance stagger for the `.card-enter` animation defined in styles/basics/base.scss
// (.plan/014). Shared by every list that renders a card collection — JobsListPage,
// CvsListPage, and JobCvsModal — so the three cannot drift apart.

const CARD_ENTER_STEP_MS = 40

// The delay is capped so a long list's last card doesn't sit invisible for seconds: every
// card past this index shares the final delay and animates together.
const CARD_ENTER_MAX_STEPS = 8

export function cardEnterDelay(index: number) {
  return `${Math.min(index, CARD_ENTER_MAX_STEPS) * CARD_ENTER_STEP_MS}ms`
}
