export type CampaignParams = {
  source: string;
  medium: string;
  campaign: string;
};

export type CampaignLink = {
  kind: "campaign";
  code: string;
  campaign: CampaignParams;
  createdAt: Date;
};

export type ReferralLink = {
  kind: "referral";
  code: string;
  referrerUserId: string;
  createdAt: Date;
};

export type Link = CampaignLink | ReferralLink;

export type LinkKind = Link["kind"];

export type Click = {
  clickId: string;
  linkCode: string;
  clickedAt: Date;
  sequence: number;
};

export type Install = {
  installId: string;
  firstOpenAt: Date;
  lastOpenAt: Date;
};

export type Touch = {
  click: Click;
  link: Link;
  installId: string;
  boundAt: Date;
};

export type InstallStatusAtSignup =
  | { status: "absent" }
  | { status: "never_opened"; installId: string }
  | { status: "consumed"; installId: string }
  | { status: "already_consumed"; installId: string; consumedBy: string; consumedAt: Date };

export type Signup = {
  userId: string;
  signupAt: Date;
  install: InstallStatusAtSignup;
};

export type AttributionPolicy = {
  windowMs: number;
  clickLookbackMs: number;
};

export type WinReason = "last_eligible_touch" | "won_tie_by_kind" | "won_tie_by_sequence";

export type LossReason =
  | "superseded_by_later_touch"
  | "lost_tie_by_kind"
  | "lost_tie_by_sequence"
  | "duplicate_click"
  | "clicked_after_signup"
  | "bound_after_signup"
  | "clicked_before_lookback"
  | "clicked_after_window"
  | "signup_after_window"
  | "install_consumed_by_previous_signup";

export type OrganicReason =
  | "no_install"
  | "install_never_opened"
  | "no_touches"
  | "no_eligible_touches"
  | "install_consumed_by_previous_signup";

export type TouchVerdict =
  | { outcome: "won"; reason: WinReason; detail: string }
  | { outcome: "lost"; reason: LossReason; detail: string; againstClickId?: string };

export type Origin =
  | { type: "campaign"; linkCode: string; clickId: string; campaign: CampaignParams }
  | { type: "referral"; linkCode: string; clickId: string; referrerUserId: string }
  | { type: "organic"; reason: OrganicReason; detail: string };

export type EvaluatedTouch = {
  touch: Touch;
  verdict: TouchVerdict;
};

export type Attribution = {
  origin: Origin;
  window: { startsAt: Date; endsAt: Date; lookbackStartsAt: Date } | null;
  touches: EvaluatedTouch[];
};
