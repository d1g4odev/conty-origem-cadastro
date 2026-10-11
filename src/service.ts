import { randomUUID } from "node:crypto";
import type { Clock } from "./clock.js";
import { DAY } from "./clock.js";
import { resolveAttribution } from "./domain/attribution.js";
import type { Attribution, AttributionPolicy, CampaignParams, Click, Install, InstallStatusAtSignup, Link, Signup, Touch } from "./domain/types.js";
import { InMemoryStore } from "./store.js";

export class DomainError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export type NewLink =
  | { kind: "campaign"; code?: string; campaign: CampaignParams }
  | { kind: "referral"; code?: string; referrerUserId: string };

export type ServiceOptions = {
  clock: Clock;
  policy?: Partial<AttributionPolicy>;
  linkBaseUrl?: string;
  appOpenUrl?: string;
  newId?: () => string;
  store?: InMemoryStore;
};

export const DEFAULT_POLICY: AttributionPolicy = { windowMs: 7 * DAY, clickLookbackMs: 1 * DAY };

export type AppOpenResult = {
  install: Install;
  isFirstOpen: boolean;
  boundClickId: string | null;
};

export type SignupResult = { signup: Signup; attribution: Attribution; policy: AttributionPolicy };

export class AttributionService {
  readonly policy: AttributionPolicy;
  private readonly clock: Clock;
  private readonly store: InMemoryStore;
  private readonly newId: () => string;
  private readonly linkBaseUrl: string;
  private readonly appOpenUrl: string;

  constructor(options: ServiceOptions) {
    this.clock = options.clock;
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    this.store = options.store ?? new InMemoryStore();
    this.newId = options.newId ?? randomUUID;
    this.linkBaseUrl = options.linkBaseUrl ?? "https://go.conty.app/l";
    this.appOpenUrl = options.appOpenUrl ?? "https://conty.app/open";
  }

  createLink(input: NewLink): Link {
    const code = input.code ?? `${input.kind === "campaign" ? "c" : "r"}-${this.newId().replaceAll("-", "").slice(0, 10)}`;
    if (this.store.links.has(code)) throw new DomainError("conflict", `link ${code} already exists`);
    const createdAt = this.clock.now();
    const link: Link =
      input.kind === "campaign"
        ? { kind: "campaign", code, campaign: input.campaign, createdAt }
        : { kind: "referral", code, referrerUserId: input.referrerUserId, createdAt };
    this.store.links.set(code, link);
    return link;
  }

  getLink(code: string): Link {
    const link = this.store.links.get(code);
    if (link === undefined) throw new DomainError("not_found", `link ${code} not found`);
    return link;
  }

  shareUrl(link: Link): string {
    const url = new URL(`${this.linkBaseUrl}/${encodeURIComponent(link.code)}`);
    if (link.kind === "campaign") {
      url.searchParams.set("utm_source", link.campaign.source);
      url.searchParams.set("utm_medium", link.campaign.medium);
      url.searchParams.set("utm_campaign", link.campaign.campaign);
    }
    return url.toString();
  }

  recordClick(code: string): { click: Click; redirectUrl: string } {
    const link = this.getLink(code);
    const click: Click = {
      clickId: this.newId(),
      linkCode: link.code,
      clickedAt: this.clock.now(),
      sequence: this.store.nextSequence(),
    };
    this.store.clicks.set(click.clickId, click);
    const redirect = new URL(this.appOpenUrl);
    redirect.searchParams.set("click_id", click.clickId);
    return { click, redirectUrl: redirect.toString() };
  }

  recordAppOpen(installId: string, clickId: string | null): AppOpenResult {
    const now = this.clock.now();
    if (clickId !== null) {
      if (!this.store.clicks.has(clickId)) throw new DomainError("not_found", `click ${clickId} not found`);
      const binding = this.store.bindings.get(clickId);
      if (binding !== undefined && binding.installId !== installId) {
        throw new DomainError("conflict", `click ${clickId} already belongs to another install`);
      }
    }

    const existing = this.store.installs.get(installId);
    const install: Install = existing
      ? { ...existing, lastOpenAt: now }
      : { installId, firstOpenAt: now, lastOpenAt: now };
    this.store.installs.set(installId, install);

    if (clickId !== null && !this.store.bindings.has(clickId)) {
      this.store.bindings.set(clickId, { installId, boundAt: now });
    }

    return { install, isFirstOpen: existing === undefined, boundClickId: clickId };
  }

  signup(userId: string, installId: string | null): SignupResult {
    if (this.store.signups.has(userId)) throw new DomainError("conflict", `user ${userId} already signed up`);
    const signup: Signup = { userId, signupAt: this.clock.now(), install: this.installStatus(installId) };
    this.store.signups.set(userId, signup);
    return this.attributionFor(userId);
  }

  private installStatus(installId: string | null): InstallStatusAtSignup {
    if (installId === null) return { status: "absent" };
    if (!this.store.installs.has(installId)) return { status: "never_opened", installId };
    const consumer = this.store.consumerOfInstall(installId);
    return consumer === null
      ? { status: "consumed", installId }
      : { status: "already_consumed", installId, consumedBy: consumer.userId, consumedAt: consumer.signupAt };
  }

  attributionFor(userId: string): SignupResult {
    const signup = this.store.signups.get(userId);
    if (signup === undefined) throw new DomainError("not_found", `signup for ${userId} not found`);
    const installId = signup.install.status === "absent" ? null : signup.install.installId;
    const attribution = resolveAttribution({
      signup,
      install: installId === null ? null : (this.store.installs.get(installId) ?? null),
      touches: installId === null ? [] : this.touchesFor(installId),
      policy: this.policy,
    });
    return { signup, attribution, policy: this.policy };
  }

  private touchesFor(installId: string): Touch[] {
    return this.store.clickIdsForInstall(installId).map((clickId) => {
      const click = this.store.clicks.get(clickId)!;
      const binding = this.store.bindings.get(clickId)!;
      return { click, link: this.getLink(click.linkCode), installId, boundAt: binding.boundAt };
    });
  }
}
