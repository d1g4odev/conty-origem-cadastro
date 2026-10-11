import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MINUTE, ManualClock } from "../src/clock.js";
import { buildApp } from "../src/http/app.js";
import { AttributionService } from "../src/service.js";
import { T0 } from "./helpers.js";

let clock: ManualClock;
let app: FastifyInstance;

beforeEach(() => {
  clock = new ManualClock(T0);
  let counter = 0;
  app = buildApp(new AttributionService({ clock, newId: () => `id-${++counter}` }));
});

async function clickLink(code: string) {
  const res = await app.inject({ method: "GET", url: `/l/${code}` });
  expect(res.statusCode).toBe(302);
  const clickId = new URL(res.headers.location as string).searchParams.get("click_id");
  expect(clickId).toBe(res.headers["x-click-id"]);
  return clickId!;
}

describe("links", () => {
  it("creates a campaign link whose share url carries code and utm params", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/links",
      payload: { kind: "campaign", code: "verao26-ig", campaign: { source: "instagram", medium: "paid_social", campaign: "verao26" } },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      kind: "campaign",
      code: "verao26-ig",
      url: "https://go.conty.app/l/verao26-ig?utm_source=instagram&utm_medium=paid_social&utm_campaign=verao26",
      campaign: { source: "instagram", medium: "paid_social", campaign: "verao26" },
      createdAt: T0,
    });
  });

  it("creates a referral link whose share url carries only the code", async () => {
    const res = await app.inject({ method: "POST", url: "/links", payload: { kind: "referral", code: "ref-ana42", referrerUserId: "user-ana" } });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ url: "https://go.conty.app/l/ref-ana42", referrerUserId: "user-ana" });
  });

  it("generates a code when none is given", async () => {
    const res = await app.inject({ method: "POST", url: "/links", payload: { kind: "referral", referrerUserId: "user-ana" } });

    expect(res.json().code).toMatch(/^r-/);
  });

  it("rejects duplicated codes, invalid bodies and unknown links", async () => {
    const body = { kind: "referral", code: "ref-ana42", referrerUserId: "user-ana" };
    await app.inject({ method: "POST", url: "/links", payload: body });

    expect((await app.inject({ method: "POST", url: "/links", payload: body })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/links", payload: { kind: "banner" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/links", payload: { ...body, code: "Bad Code" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/l/nope" })).statusCode).toBe(404);
  });
});

describe("app opens", () => {
  it("records the first open once and binds clicks", async () => {
    await app.inject({ method: "POST", url: "/links", payload: { kind: "referral", code: "ref-ana42", referrerUserId: "user-ana" } });
    const clickId = await clickLink("ref-ana42");
    clock.advance(MINUTE);

    const first = await app.inject({ method: "POST", url: "/app-opens", payload: { installId: "install-1", clickId } });
    clock.advance(MINUTE);
    const second = await app.inject({ method: "POST", url: "/app-opens", payload: { installId: "install-1" } });

    expect(first.json()).toEqual({
      installId: "install-1",
      isFirstOpen: true,
      firstOpenAt: "2026-10-01T12:01:00.000Z",
      lastOpenAt: "2026-10-01T12:01:00.000Z",
      boundClickId: clickId,
    });
    expect(second.json()).toMatchObject({ isFirstOpen: false, firstOpenAt: "2026-10-01T12:01:00.000Z", lastOpenAt: "2026-10-01T12:02:00.000Z" });
  });

  it("refuses unknown clicks and clicks already owned by another install", async () => {
    await app.inject({ method: "POST", url: "/links", payload: { kind: "referral", code: "ref-ana42", referrerUserId: "user-ana" } });
    const clickId = await clickLink("ref-ana42");
    await app.inject({ method: "POST", url: "/app-opens", payload: { installId: "install-1", clickId } });

    const stolen = await app.inject({ method: "POST", url: "/app-opens", payload: { installId: "install-2", clickId } });
    const unknown = await app.inject({ method: "POST", url: "/app-opens", payload: { installId: "install-2", clickId: "forged" } });

    expect(stolen.statusCode).toBe(409);
    expect(unknown.statusCode).toBe(404);
  });
});

describe("signups", () => {
  it("returns the origin and every touch with its verdict", async () => {
    await app.inject({
      method: "POST",
      url: "/links",
      payload: { kind: "campaign", code: "verao26-ig", campaign: { source: "instagram", medium: "paid_social", campaign: "verao26" } },
    });
    await app.inject({ method: "POST", url: "/links", payload: { kind: "referral", code: "ref-ana42", referrerUserId: "user-ana" } });

    const campaignClick = await clickLink("verao26-ig");
    clock.advance(MINUTE);
    await app.inject({ method: "POST", url: "/app-opens", payload: { installId: "install-1", clickId: campaignClick } });
    clock.advance(MINUTE);
    const referralClick = await clickLink("ref-ana42");
    await app.inject({ method: "POST", url: "/app-opens", payload: { installId: "install-1", clickId: referralClick } });
    clock.advance(MINUTE);

    const res = await app.inject({ method: "POST", url: "/signups", payload: { userId: "user-1", installId: "install-1" } });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      userId: "user-1",
      signupAt: "2026-10-01T12:03:00.000Z",
      installId: "install-1",
      origin: { type: "referral", linkCode: "ref-ana42", clickId: referralClick, referrerUserId: "user-ana" },
      window: {
        lookbackStartsAt: "2026-09-30T12:01:00.000Z",
        firstOpenAt: "2026-10-01T12:01:00.000Z",
        endsAt: "2026-10-08T12:01:00.000Z",
      },
    });
    expect(body.rule.winner).toContain("last eligible touch");
    expect(body.touches).toEqual([
      expect.objectContaining({ clickId: campaignClick, kind: "campaign", outcome: "lost", reason: "superseded_by_later_touch", againstClickId: referralClick }),
      expect.objectContaining({ clickId: referralClick, kind: "referral", outcome: "won", reason: "last_eligible_touch" }),
    ]);

    const again = await app.inject({ method: "GET", url: "/signups/user-1/attribution" });
    expect(again.json()).toEqual(body);
  });

  it("returns organic with reason when nothing brought the user", async () => {
    const res = await app.inject({ method: "POST", url: "/signups", payload: { userId: "user-1" } });

    expect(res.json()).toMatchObject({ origin: { type: "organic", reason: "no_install" }, window: null, touches: [] });
  });

  it("rejects a second signup for the same user and unknown attribution lookups", async () => {
    await app.inject({ method: "POST", url: "/signups", payload: { userId: "user-1" } });

    expect((await app.inject({ method: "POST", url: "/signups", payload: { userId: "user-1" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/signups", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/signups/ghost/attribution" })).statusCode).toBe(404);
  });
});
