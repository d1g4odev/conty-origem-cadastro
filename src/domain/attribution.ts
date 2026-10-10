import type {
  Attribution,
  AttributionPolicy,
  EvaluatedTouch,
  Install,
  LinkKind,
  LossReason,
  Origin,
  Signup,
  Touch,
  TouchVerdict,
} from "./types.js";

export const WINNER_RULE =
  "last eligible touch wins; on equal clickedAt a referral beats a campaign; if still tied, the click recorded later by the server (higher sequence) wins";

const KIND_PRIORITY: Record<LinkKind, number> = { referral: 2, campaign: 1 };

export type AttributionInput = {
  signup: Signup;
  install: Install | null;
  touches: Touch[];
  policy: AttributionPolicy;
};

const iso = (d: Date) => d.toISOString();

const chronological = (a: Touch, b: Touch) =>
  a.click.clickedAt.getTime() - b.click.clickedAt.getTime() || a.click.sequence - b.click.sequence;

const ranking = (a: Touch, b: Touch) =>
  b.click.clickedAt.getTime() - a.click.clickedAt.getTime() ||
  KIND_PRIORITY[b.link.kind] - KIND_PRIORITY[a.link.kind] ||
  b.click.sequence - a.click.sequence;

const lost = (reason: LossReason, detail: string, againstClickId?: string): TouchVerdict =>
  againstClickId === undefined
    ? { outcome: "lost", reason, detail }
    : { outcome: "lost", reason, detail, againstClickId };

export function resolveAttribution(input: AttributionInput): Attribution {
  const { signup, install, policy } = input;
  const { signupAt } = signup;
  const touches = [...input.touches].sort(chronological);

  if (signup.install.status === "absent") {
    return organic("no_install", "signup did not carry an installId, so no app open or link can be linked to it", null, []);
  }

  const { installId } = signup.install;

  if (signup.install.status === "never_opened" || install === null) {
    return organic(
      "install_never_opened",
      `install ${installId} had not reported an app open before signup`,
      null,
      touches.map((touch) => ({ touch, verdict: lost("bound_after_signup", `app reported this click at ${iso(touch.boundAt)}, after signup at ${iso(signupAt)}`) })),
    );
  }

  const window = {
    startsAt: install.firstOpenAt,
    endsAt: new Date(install.firstOpenAt.getTime() + policy.windowMs),
    lookbackStartsAt: new Date(install.firstOpenAt.getTime() - policy.clickLookbackMs),
  };

  if (signup.install.status === "already_consumed") {
    const detail = `install ${installId} was already consumed by signup of ${signup.install.consumedBy} at ${iso(signup.install.consumedAt)}`;
    return organic(
      "install_consumed_by_previous_signup",
      detail,
      window,
      touches.map((touch) => ({ touch, verdict: lost("install_consumed_by_previous_signup", detail) })),
    );
  }

  const verdicts = new Map<string, TouchVerdict>();
  const eligible: Touch[] = [];

  for (const touch of touches) {
    const { clickedAt } = touch.click;
    if (clickedAt > signupAt) {
      verdicts.set(touch.click.clickId, lost("clicked_after_signup", `clicked at ${iso(clickedAt)}, after signup at ${iso(signupAt)}`));
    } else if (touch.boundAt > signupAt) {
      verdicts.set(touch.click.clickId, lost("bound_after_signup", `app reported this click at ${iso(touch.boundAt)}, after signup at ${iso(signupAt)}`));
    } else if (signupAt > window.endsAt) {
      verdicts.set(touch.click.clickId, lost("signup_after_window", `signup at ${iso(signupAt)} is after the window closed at ${iso(window.endsAt)}`));
    } else if (clickedAt < window.lookbackStartsAt) {
      verdicts.set(touch.click.clickId, lost("clicked_before_lookback", `clicked at ${iso(clickedAt)}, before lookback start ${iso(window.lookbackStartsAt)}`));
    } else {
      eligible.push(touch);
    }
  }

  const representatives = new Map<string, Touch>();
  for (const touch of eligible) {
    const current = representatives.get(touch.link.code);
    if (current === undefined || ranking(touch, current) < 0) representatives.set(touch.link.code, touch);
  }

  for (const touch of eligible) {
    const representative = representatives.get(touch.link.code);
    if (representative !== undefined && representative !== touch) {
      verdicts.set(
        touch.click.clickId,
        lost("duplicate_click", `repeated click on link ${touch.link.code}; counted once as click ${representative.click.clickId}`, representative.click.clickId),
      );
    }
  }

  const ranked = [...representatives.values()].sort(ranking);
  const [winner, ...losers] = ranked;

  if (winner === undefined) {
    const evaluated = touches.map((touch) => ({ touch, verdict: verdicts.get(touch.click.clickId)! }));
    return touches.length === 0
      ? organic("no_touches", "no link click was ever bound to this install", window, evaluated)
      : organic("no_eligible_touches", `${touches.length} touch(es) found, none eligible`, window, evaluated);
  }

  const tied = losers.filter((t) => t.click.clickedAt.getTime() === winner.click.clickedAt.getTime());
  const winnerId = winner.click.clickId;

  for (const loser of losers) {
    const sameTime = loser.click.clickedAt.getTime() === winner.click.clickedAt.getTime();
    if (!sameTime) {
      verdicts.set(
        loser.click.clickId,
        lost("superseded_by_later_touch", `clicked at ${iso(loser.click.clickedAt)}; click ${winnerId} at ${iso(winner.click.clickedAt)} is more recent`, winnerId),
      );
    } else if (loser.link.kind !== winner.link.kind) {
      verdicts.set(
        loser.click.clickId,
        lost("lost_tie_by_kind", `same clickedAt as ${winnerId}; referral beats campaign on ties`, winnerId),
      );
    } else {
      verdicts.set(
        loser.click.clickId,
        lost("lost_tie_by_sequence", `same clickedAt and kind as ${winnerId}; server recorded ${winnerId} later (sequence ${winner.click.sequence} > ${loser.click.sequence})`, winnerId),
      );
    }
  }

  verdicts.set(winnerId, winVerdict(winner, tied));

  return {
    origin: originOf(winner),
    window,
    touches: touches.map((touch) => ({ touch, verdict: verdicts.get(touch.click.clickId)! })),
  };
}

function winVerdict(winner: Touch, tied: Touch[]): TouchVerdict {
  if (tied.length === 0) {
    return { outcome: "won", reason: "last_eligible_touch", detail: `most recent eligible click before signup (${iso(winner.click.clickedAt)})` };
  }
  if (tied.every((t) => t.link.kind !== winner.link.kind)) {
    return { outcome: "won", reason: "won_tie_by_kind", detail: `tied on clickedAt with ${tied.length} touch(es); referral beats campaign` };
  }
  return { outcome: "won", reason: "won_tie_by_sequence", detail: `tied on clickedAt and kind; highest server sequence (${winner.click.sequence})` };
}

function originOf(touch: Touch): Origin {
  const { link, click } = touch;
  return link.kind === "campaign"
    ? { type: "campaign", linkCode: link.code, clickId: click.clickId, campaign: link.campaign }
    : { type: "referral", linkCode: link.code, clickId: click.clickId, referrerUserId: link.referrerUserId };
}

function organic(
  reason: Extract<Origin, { type: "organic" }>["reason"],
  detail: string,
  window: Attribution["window"],
  touches: EvaluatedTouch[],
): Attribution {
  return { origin: { type: "organic", reason, detail }, window, touches };
}
