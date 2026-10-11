import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { AttributionService, DomainError } from "../service.js";
import { appOpenDto, attributionDto, linkDto } from "./dto.js";

const id = z.string().trim().min(1).max(128);
const code = z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/, "lowercase letters, digits and dashes, 3-64 chars");
const label = z.string().trim().min(1).max(100);

const newLinkBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("campaign"),
    code: code.optional(),
    campaign: z.object({ source: label, medium: label, campaign: label }),
  }),
  z.object({ kind: z.literal("referral"), code: code.optional(), referrerUserId: id }),
]);

const appOpenBody = z.object({ installId: id, clickId: id.nullish() });
const signupBody = z.object({ userId: id, installId: id.nullish() });
const codeParams = z.object({ code: z.string() });
const userParams = z.object({ userId: id });

const STATUS: Record<DomainError["code"], number> = { not_found: 404, conflict: 409, invalid: 400 };

export function buildApp(service: AttributionService): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: "invalid_request", issues: error.issues });
    }
    if (error instanceof DomainError) {
      return reply.status(STATUS[error.code]).send({ error: error.code, message: error.message });
    }
    return reply.status(500).send({ error: "internal", message: "unexpected error" });
  });

  app.post("/links", async (request, reply) => {
    const body = newLinkBody.parse(request.body);
    const link = service.createLink(
      body.kind === "campaign"
        ? { kind: "campaign", campaign: body.campaign, ...(body.code ? { code: body.code } : {}) }
        : { kind: "referral", referrerUserId: body.referrerUserId, ...(body.code ? { code: body.code } : {}) },
    );
    return reply.status(201).send(linkDto(link, service.shareUrl(link)));
  });

  app.get("/links/:code", async (request) => {
    const link = service.getLink(codeParams.parse(request.params).code);
    return linkDto(link, service.shareUrl(link));
  });

  app.get("/l/:code", async (request, reply) => {
    const { click, redirectUrl } = service.recordClick(codeParams.parse(request.params).code);
    return reply.header("x-click-id", click.clickId).redirect(redirectUrl, 302);
  });

  app.post("/app-opens", async (request) => {
    const body = appOpenBody.parse(request.body);
    return appOpenDto(service.recordAppOpen(body.installId, body.clickId ?? null));
  });

  app.post("/signups", async (request, reply) => {
    const body = signupBody.parse(request.body);
    return reply.status(201).send(attributionDto(service.signup(body.userId, body.installId ?? null)));
  });

  app.get("/signups/:userId/attribution", async (request) => {
    return attributionDto(service.attributionFor(userParams.parse(request.params).userId));
  });

  return app;
}
