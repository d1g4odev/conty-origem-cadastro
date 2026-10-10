import { systemClock } from "./clock.js";
import { buildApp } from "./http/app.js";
import { AttributionService } from "./service.js";

const port = Number(process.env.PORT ?? 3000);
const app = buildApp(new AttributionService({ clock: systemClock }));

app.listen({ port, host: "0.0.0.0" }).then(
  (address) => console.log(`attribution api listening on ${address}`),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
