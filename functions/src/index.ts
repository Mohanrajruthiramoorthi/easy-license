import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { createApp } from "./app";
import { checkDatabase } from "./database";

const databaseUrl = defineSecret("DATABASE_URL");

const app = createApp(async () => {
  await checkDatabase(databaseUrl.value());
});

/**
 * Public HTTP entry point. Authentication and authorization are applied by
 * individual versioned API routes as those modules are implemented.
 */
export const api = onRequest(
  {
    region: "asia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 30,
    maxInstances: 3,
    concurrency: 20,
    minInstances: 0,
    secrets: [databaseUrl],
  },
  app,
);
