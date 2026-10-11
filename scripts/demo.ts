import { HOUR, MINUTE, ManualClock } from "../src/clock.js";
import { buildApp } from "../src/http/app.js";
import { AttributionService } from "../src/service.js";

const clock = new ManualClock("2026-10-01T12:00:00.000Z");
let counter = 0;
const app = buildApp(new AttributionService({ clock, newId: () => `clk-${++counter}` }));

async function call(method: "GET" | "POST", url: string, payload?: Record<string, unknown>) {
  const res = await app.inject(payload === undefined ? { method, url } : { method, url, payload });
  console.log(`\n${method} ${url}${payload === undefined ? "" : ` ${JSON.stringify(payload)}`}`);
  console.log(`${res.statusCode}${res.headers.location ? ` Location: ${res.headers.location}` : ""}`);
  if (res.body) console.log(JSON.stringify(res.json(), null, 2));
  return res;
}

const clickId = async (code: string) => new URL((await call("GET", `/l/${code}`)).headers.location as string).searchParams.get("click_id");

await call("POST", "/links", {
  kind: "campaign",
  code: "verao26-ig",
  campaign: { source: "instagram", medium: "paid_social", campaign: "verao26" },
});
await call("POST", "/links", { kind: "referral", code: "ref-ana42", referrerUserId: "user-ana" });

const first = await clickId("verao26-ig");
clock.advance(MINUTE);
const repeat = await clickId("verao26-ig");
clock.advance(2 * MINUTE);
await call("POST", "/app-opens", { installId: "inst-7f3a", clickId: first });
await call("POST", "/app-opens", { installId: "inst-7f3a", clickId: repeat });
clock.advance(3 * HOUR);
const referral = await clickId("ref-ana42");
await call("POST", "/app-opens", { installId: "inst-7f3a", clickId: referral });
clock.advance(10 * MINUTE);
await call("POST", "/signups", { userId: "user-bruno", installId: "inst-7f3a" });
clock.advance(HOUR);
const late = await clickId("verao26-ig");
await call("POST", "/app-opens", { installId: "inst-7f3a", clickId: late });
await call("GET", "/signups/user-bruno/attribution");
await call("POST", "/signups", { userId: "user-carla" });
