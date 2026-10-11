import { describe, expect, it } from "vitest";
import { DAY, HOUR, MINUTE } from "../src/clock.js";
import { setup, T0, verdicts } from "./helpers.js";

describe("single origin", () => {
  it("attributes a signup to the campaign link that brought the install", () => {
    const { clock, service, click } = setup();
    const c1 = click("verao26-ig");
    clock.advance(2 * MINUTE);
    service.recordAppOpen("install-1", c1);
    clock.advance(10 * MINUTE);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.origin).toEqual({
      type: "campaign",
      linkCode: "verao26-ig",
      clickId: c1,
      campaign: { source: "instagram", medium: "paid_social", campaign: "verao26" },
    });
    expect(attribution.touches[0]?.verdict).toMatchObject({ outcome: "won", reason: "last_eligible_touch" });
  });

  it("attributes a signup to the referrer of a referral link", () => {
    const { clock, service, click } = setup();
    const r1 = click("ref-ana42");
    clock.advance(MINUTE);
    service.recordAppOpen("install-1", r1);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.origin).toEqual({ type: "referral", linkCode: "ref-ana42", clickId: r1, referrerUserId: "user-ana" });
  });
});

describe("repeated clicks", () => {
  it("counts many clicks on the same link as one origin represented by the latest click", () => {
    const { clock, service, click } = setup();
    const first = click("ref-ana42");
    clock.advance(MINUTE);
    const second = click("ref-ana42");
    clock.advance(MINUTE);
    const third = click("ref-ana42");
    service.recordAppOpen("install-1", first);
    service.recordAppOpen("install-1", second);
    service.recordAppOpen("install-1", third);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.origin).toMatchObject({ type: "referral", clickId: third });
    expect(attribution.touches.filter((t) => t.verdict.outcome === "won")).toHaveLength(1);
    expect(verdicts(service, "user-1")).toEqual({
      [first]: "duplicate_click",
      [second]: "duplicate_click",
      [third]: "last_eligible_touch",
    });
    expect(attribution.touches[0]?.verdict).toMatchObject({ againstClickId: third });
  });

  it("treats the app reporting the same click twice as a single touch", () => {
    const { service, click } = setup();
    const c1 = click("verao26-ig");
    service.recordAppOpen("install-1", c1);
    service.recordAppOpen("install-1", c1);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.touches).toHaveLength(1);
  });

  it("keeps a single origin when the same link is clicked twice in the same instant", () => {
    const { service, click } = setup();
    const a = click("verao26-ig");
    const b = click("verao26-ig");
    service.recordAppOpen("install-1", a);
    service.recordAppOpen("install-1", b);

    service.signup("user-1", "install-1");

    expect(verdicts(service, "user-1")).toEqual({ [a]: "duplicate_click", [b]: "last_eligible_touch" });
  });
});

describe("two links before signup", () => {
  it("gives the signup to the last eligible touch and explains why the first lost", () => {
    const { clock, service, click } = setup();
    const campaignClick = click("verao26-ig");
    clock.advance(MINUTE);
    service.recordAppOpen("install-1", campaignClick);
    clock.advance(2 * HOUR);
    const referralClick = click("ref-ana42");
    clock.advance(MINUTE);
    service.recordAppOpen("install-1", referralClick);
    clock.advance(MINUTE);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.origin).toMatchObject({ type: "referral", clickId: referralClick });
    expect(attribution.touches.map((t) => t.verdict)).toEqual([
      expect.objectContaining({ outcome: "lost", reason: "superseded_by_later_touch", againstClickId: referralClick }),
      expect.objectContaining({ outcome: "won", reason: "last_eligible_touch" }),
    ]);
  });

  it("lets a later campaign beat an earlier referral, since the rule is last touch", () => {
    const { clock, service, click } = setup();
    const referralClick = click("ref-ana42");
    service.recordAppOpen("install-1", referralClick);
    clock.advance(HOUR);
    const campaignClick = click("verao26-tt");
    service.recordAppOpen("install-1", campaignClick);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.origin).toMatchObject({ type: "campaign", linkCode: "verao26-tt" });
    expect(verdicts(service, "user-1")[referralClick]).toBe("superseded_by_later_touch");
  });

  it("breaks a timestamp tie in favor of the referral even if the campaign was recorded later", () => {
    const { service, click } = setup();
    const referralClick = click("ref-ana42");
    const campaignClick = click("verao26-ig");
    service.recordAppOpen("install-1", campaignClick);
    service.recordAppOpen("install-1", referralClick);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.touches.map((t) => t.touch.click.clickedAt.getTime())).toEqual([
      attribution.touches[0]!.touch.click.clickedAt.getTime(),
      attribution.touches[0]!.touch.click.clickedAt.getTime(),
    ]);
    expect(attribution.origin).toMatchObject({ type: "referral", clickId: referralClick });
    expect(verdicts(service, "user-1")).toEqual({
      [referralClick]: "won_tie_by_kind",
      [campaignClick]: "lost_tie_by_kind",
    });
  });

  it("breaks a timestamp tie between two campaigns by the server sequence", () => {
    const { service, click } = setup();
    const earlierRecorded = click("verao26-ig");
    const laterRecorded = click("verao26-tt");
    service.recordAppOpen("install-1", laterRecorded);
    service.recordAppOpen("install-1", earlierRecorded);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.origin).toMatchObject({ type: "campaign", linkCode: "verao26-tt" });
    expect(verdicts(service, "user-1")).toEqual({
      [earlierRecorded]: "lost_tie_by_sequence",
      [laterRecorded]: "won_tie_by_sequence",
    });
  });
});

describe("validity window measured from first app open", () => {
  it("accepts a signup exactly at the end of the window", () => {
    const { clock, service, click } = setup();
    const c1 = click("verao26-ig");
    service.recordAppOpen("install-1", c1);
    clock.advance(7 * DAY);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.origin.type).toBe("campaign");
    expect(attribution.window?.endsAt.toISOString()).toBe("2026-10-08T12:00:00.000Z");
  });

  it("turns organic one millisecond after the window closes", () => {
    const { clock, service, click } = setup();
    const c1 = click("verao26-ig");
    service.recordAppOpen("install-1", c1);
    clock.advance(7 * DAY + 1);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.origin).toMatchObject({ type: "organic", reason: "no_eligible_touches" });
    expect(verdicts(service, "user-1")).toEqual({ [c1]: "signup_after_window" });
  });

  it("counts the window from first open, not from the click, so a click before install still fits", () => {
    const { clock, service, click } = setup();
    const c1 = click("verao26-ig");
    clock.advance(20 * HOUR);
    service.recordAppOpen("install-1", c1);
    clock.advance(7 * DAY);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.origin.type).toBe("campaign");
    expect(attribution.window?.startsAt.toISOString()).toBe("2026-10-02T08:00:00.000Z");
  });

  it("does not restart the window on later app opens", () => {
    const { clock, service, click } = setup();
    const c1 = click("verao26-ig");
    service.recordAppOpen("install-1", c1);
    clock.advance(6 * DAY);
    const reopen = service.recordAppOpen("install-1", null);
    clock.advance(2 * DAY);

    const { attribution } = service.signup("user-1", "install-1");

    expect(reopen.isFirstOpen).toBe(false);
    expect(reopen.install.firstOpenAt.toISOString()).toBe(T0);
    expect(attribution.origin).toMatchObject({ type: "organic", reason: "no_eligible_touches" });
  });

  it("rejects a click made longer than the lookback before the first open", () => {
    const { clock, service, click } = setup();
    const stale = click("verao26-ig");
    clock.advance(DAY + 1);
    service.recordAppOpen("install-1", stale);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.origin).toMatchObject({ type: "organic", reason: "no_eligible_touches" });
    expect(verdicts(service, "user-1")).toEqual({ [stale]: "clicked_before_lookback" });
  });

  it("honors a custom policy", () => {
    const { clock, service, click } = setup({ windowMs: HOUR });
    const c1 = click("verao26-ig");
    service.recordAppOpen("install-1", c1);
    clock.advance(HOUR + 1);

    expect(service.signup("user-1", "install-1").attribution.origin.type).toBe("organic");
  });
});

describe("links after signup", () => {
  it("lists a click after signup as lost without changing the origin", () => {
    const { clock, service, click } = setup();
    const before = click("verao26-ig");
    service.recordAppOpen("install-1", before);
    clock.advance(HOUR);
    service.signup("user-1", "install-1");
    clock.advance(MINUTE);
    const after = click("ref-ana42");
    service.recordAppOpen("install-1", after);

    const { attribution } = service.attributionFor("user-1");

    expect(attribution.origin).toMatchObject({ type: "campaign", clickId: before });
    expect(verdicts(service, "user-1")).toEqual({ [before]: "last_eligible_touch", [after]: "clicked_after_signup" });
  });

  it("ignores a click made before signup but only reported by the app after signup", () => {
    const { clock, service, click } = setup();
    service.recordAppOpen("install-1", null);
    const late = click("ref-ana42");
    clock.advance(MINUTE);
    service.signup("user-1", "install-1");
    clock.advance(MINUTE);
    service.recordAppOpen("install-1", late);

    const { attribution } = service.attributionFor("user-1");

    expect(attribution.origin).toMatchObject({ type: "organic", reason: "no_eligible_touches" });
    expect(verdicts(service, "user-1")).toEqual({ [late]: "bound_after_signup" });
  });

  it("does not let a second account on the same install reuse consumed touches", () => {
    const { clock, service, click } = setup();
    const c1 = click("verao26-ig");
    service.recordAppOpen("install-1", c1);
    service.signup("user-1", "install-1");
    clock.advance(MINUTE);

    const second = service.signup("user-2", "install-1");

    expect(second.attribution.origin).toMatchObject({ type: "organic", reason: "install_consumed_by_previous_signup" });
    expect(verdicts(service, "user-2")).toEqual({ [c1]: "install_consumed_by_previous_signup" });
    expect(service.attributionFor("user-1").attribution.origin.type).toBe("campaign");
  });
});

describe("organic signups", () => {
  it("is organic with reason no_install when signup carries no installId", () => {
    const { service } = setup();
    expect(service.signup("user-1", null).attribution.origin).toMatchObject({ type: "organic", reason: "no_install" });
  });

  it("is organic with reason no_touches when the app opened without any link", () => {
    const { service } = setup();
    service.recordAppOpen("install-1", null);

    const { attribution } = service.signup("user-1", "install-1");

    expect(attribution.origin).toMatchObject({ type: "organic", reason: "no_touches" });
    expect(attribution.touches).toEqual([]);
  });

  it("is organic with reason install_never_opened when the install is unknown at signup", () => {
    const { clock, service, click } = setup();
    service.signup("user-1", "install-ghost");
    clock.advance(MINUTE);
    service.recordAppOpen("install-ghost", click("verao26-ig"));

    const { attribution } = service.attributionFor("user-1");

    expect(attribution.origin).toMatchObject({ type: "organic", reason: "install_never_opened" });
    expect(attribution.touches.map((t) => t.verdict.reason)).toEqual(["bound_after_signup"]);
  });
});

describe("full explanation", () => {
  it("returns every touch with its outcome and reason", () => {
    const { clock, service, click } = setup();
    const stale = click("verao26-tt");
    clock.advance(DAY + HOUR);
    const install = click("verao26-ig");
    clock.advance(MINUTE);
    service.recordAppOpen("install-1", stale);
    service.recordAppOpen("install-1", install);
    clock.advance(HOUR);
    const repeat = click("verao26-ig");
    service.recordAppOpen("install-1", repeat);
    clock.advance(HOUR);
    const referral = click("ref-ana42");
    service.recordAppOpen("install-1", referral);
    clock.advance(MINUTE);
    service.signup("user-1", "install-1");
    clock.advance(MINUTE);
    const afterwards = click("verao26-tt");
    service.recordAppOpen("install-1", afterwards);

    const { attribution } = service.attributionFor("user-1");

    expect(attribution.origin).toMatchObject({ type: "referral", referrerUserId: "user-ana" });
    expect(attribution.touches.map((t) => [t.touch.link.code, t.verdict.outcome, t.verdict.reason])).toEqual([
      ["verao26-tt", "lost", "clicked_before_lookback"],
      ["verao26-ig", "lost", "duplicate_click"],
      ["verao26-ig", "lost", "superseded_by_later_touch"],
      ["ref-ana42", "won", "last_eligible_touch"],
      ["verao26-tt", "lost", "clicked_after_signup"],
    ]);
    expect(attribution.touches.map((t) => t.touch.click.clickId)).toEqual([stale, install, repeat, referral, afterwards]);
    expect(attribution.touches.every((t) => t.verdict.detail.length > 0)).toBe(true);
  });
});
