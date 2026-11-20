import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("HTTP foundation", () => {
  it("returns liveness without requiring the database", async () => {
    const checkDatabase = vi.fn(async () => undefined);
    const response = await request(createApp(checkDatabase)).get("/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(checkDatabase).not.toHaveBeenCalled();
  });

  it("returns ready when the database check succeeds", async () => {
    const response = await request(createApp(async () => undefined)).get("/readyz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ready",
      dependencies: { database: "ok" },
    });
  });

  it("does not leak database errors when readiness fails", async () => {
    const response = await request(
      createApp(async () => {
        throw new Error("sensitive database connection details");
      }),
    ).get("/readyz");

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain("sensitive");
  });

  it("returns a consistent not-found response", async () => {
    const response = await request(createApp(async () => undefined)).get("/not-a-route");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});
