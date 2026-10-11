import { WINNER_RULE } from "../domain/attribution.js";
import type { EvaluatedTouch, Link } from "../domain/types.js";
import type { AppOpenResult, SignupResult } from "../service.js";

export function linkDto(link: Link, url: string) {
  return link.kind === "campaign"
    ? { kind: link.kind, code: link.code, url, campaign: link.campaign, createdAt: link.createdAt.toISOString() }
    : { kind: link.kind, code: link.code, url, referrerUserId: link.referrerUserId, createdAt: link.createdAt.toISOString() };
}

export function appOpenDto(result: AppOpenResult) {
  return {
    installId: result.install.installId,
    isFirstOpen: result.isFirstOpen,
    firstOpenAt: result.install.firstOpenAt.toISOString(),
    lastOpenAt: result.install.lastOpenAt.toISOString(),
    boundClickId: result.boundClickId,
  };
}

function touchDto({ touch, verdict }: EvaluatedTouch) {
  const source =
    touch.link.kind === "campaign" ? { campaign: touch.link.campaign } : { referrerUserId: touch.link.referrerUserId };
  return {
    clickId: touch.click.clickId,
    linkCode: touch.link.code,
    kind: touch.link.kind,
    ...source,
    clickedAt: touch.click.clickedAt.toISOString(),
    boundAt: touch.boundAt.toISOString(),
    sequence: touch.click.sequence,
    ...verdict,
  };
}

export function attributionDto({ signup, attribution, policy }: SignupResult) {
  const { window } = attribution;
  return {
    userId: signup.userId,
    signupAt: signup.signupAt.toISOString(),
    installId: signup.install.status === "absent" ? null : signup.install.installId,
    origin: attribution.origin,
    rule: {
      winner: WINNER_RULE,
      windowMs: policy.windowMs,
      clickLookbackMs: policy.clickLookbackMs,
    },
    window:
      window === null
        ? null
        : {
            lookbackStartsAt: window.lookbackStartsAt.toISOString(),
            firstOpenAt: window.startsAt.toISOString(),
            endsAt: window.endsAt.toISOString(),
          },
    touches: attribution.touches.map(touchDto),
  };
}
