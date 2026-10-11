import { ManualClock } from "../src/clock.js";
import type { AttributionPolicy } from "../src/domain/types.js";
import { AttributionService } from "../src/service.js";

export const T0 = "2026-10-01T12:00:00.000Z";

export function setup(policy?: Partial<AttributionPolicy>) {
  const clock = new ManualClock(T0);
  let counter = 0;
  const service = new AttributionService({
    clock,
    newId: () => `id-${++counter}`,
    ...(policy ? { policy } : {}),
  });
  const campaign = service.createLink({
    kind: "campaign",
    code: "verao26-ig",
    campaign: { source: "instagram", medium: "paid_social", campaign: "verao26" },
  });
  const otherCampaign = service.createLink({
    kind: "campaign",
    code: "verao26-tt",
    campaign: { source: "tiktok", medium: "paid_social", campaign: "verao26" },
  });
  const referral = service.createLink({ kind: "referral", code: "ref-ana42", referrerUserId: "user-ana" });
  const click = (code: string) => service.recordClick(code).click.clickId;
  return { clock, service, campaign, otherCampaign, referral, click };
}

export function verdicts(service: AttributionService, userId: string) {
  return Object.fromEntries(
    service.attributionFor(userId).attribution.touches.map((t) => [t.touch.click.clickId, t.verdict.reason]),
  );
}
