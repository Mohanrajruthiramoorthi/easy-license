import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";

export type DatabaseHealthCheck = () => Promise<void>;

export function createApp(checkDatabase: DatabaseHealthCheck): Express {
  const app = express();
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // Non-browser clients do not send Origin. Browser origins must be explicitly allowed.
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Origin is not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id"],
    }),
  );
  app.use(express.json({ limit: "1mb", strict: true }));

  app.get("/healthz", (_request: Request, response: Response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/readyz", async (_request: Request, response: Response, next: NextFunction) => {
    try {
      await checkDatabase();
      response.status(200).json({ status: "ready", dependencies: { database: "ok" } });
    } catch (error) {
      next(error);
    }
  });

  app.use((_request: Request, response: Response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "The requested resource was not found.",
      },
    });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    // Do not expose database, configuration, or stack details to API callers.
    response.status(503).json({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The service is temporarily unavailable.",
      },
    });
  });

  return app;
}
