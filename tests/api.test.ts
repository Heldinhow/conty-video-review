import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

function app() {
  return createApp();
}

describe("ticket 02: bootstrap campaigns and deliveries", () => {
  it("creates a campaign with requiredPieces and shows a new delivery as not approved with all required missing", async () => {
    const a = app();
    const camp = await request(a)
      .post("/campaigns")
      .send({ requiredPieces: ["roteiro", "video", "capa", "legenda"] });
    expect(camp.status).toBe(201);
    const campaignId = camp.body.id as string;
    expect(camp.body.requiredPieces).toEqual(["roteiro", "video", "capa", "legenda"]);

    const del = await request(a).post("/deliveries").send({ campaignId });
    expect(del.status).toBe(201);

    const got = await request(a).get(`/deliveries/${del.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body.approved).toBe(false);
    expect(got.body.missing).toEqual(["roteiro", "video", "capa", "legenda"]);
  });

  it("creates a video-only campaign; its delivery misses only video", async () => {
    const a = app();
    const camp = await request(a).post("/campaigns").send({ requiredPieces: ["video"] });
    expect(camp.status).toBe(201);
    const got = await request(a)
      .post("/deliveries")
      .send({ campaignId: camp.body.id });
    expect(got.status).toBe(201);
    const view = await request(a).get(`/deliveries/${got.body.id}`);
    expect(view.body.approved).toBe(false);
    expect(view.body.missing).toEqual(["video"]);
  });

  it("normalizes case and accent (VÍDEO -> video)", async () => {
    const a = app();
    const camp = await request(a)
      .post("/campaigns")
      .send({ requiredPieces: ["VÍDEO", "Roteiro"] });
    expect(camp.status).toBe(201);
    expect(camp.body.requiredPieces).toEqual(["video", "roteiro"]);
  });

  it.each([
    ["missing body field", {}],
    ["empty array", { requiredPieces: [] }],
    ["duplicated piece", { requiredPieces: ["video", "VIDEO"] }],
    ["off-enum value", { requiredPieces: ["video", "edicao"] }],
    ["non-array", { requiredPieces: "video" }],
  ])("rejects campaign with 400: %s", async (_, body) => {
    const a = app();
    const res = await request(a).post("/campaigns").send(body);
    expect(res.status).toBe(400);
  });

  it("rejects delivery for unknown campaign with 404", async () => {
    const a = app();
    const res = await request(a).post("/deliveries").send({ campaignId: "nope" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown delivery", async () => {
    const a = app();
    const res = await request(a).get("/deliveries/nope");
    expect(res.status).toBe(404);
  });
});
