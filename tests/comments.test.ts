import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetStore } from "../src/store";

beforeEach(() => resetStore());

async function versionFor(a: ReturnType<typeof createApp>) {
  const camp = await request(a).post("/campaigns").send({ requiredPieces: ["video"] });
  const del = await request(a).post("/deliveries").send({ campaignId: camp.body.id });
  const v = await request(a)
    .post(`/deliveries/${del.body.id}/versions`)
    .send({ piece: "video", contentUrl: "http://x/v1.mp4" });
  return v.body.id as string;
}

describe("ticket 06: comments anchored to a version second", () => {
  it("posts a comment anchored to a second; second: 0 is valid", async () => {
    const a = createApp();
    const versionId = await versionFor(a);
    const res = await request(a)
      .post(`/versions/${versionId}/comments`)
      .send({ second: 0, body: "trim here" });
    expect(res.status).toBe(201);
    expect(res.body.second).toBe(0);
    expect(res.body.body).toBe("trim here");
    expect(res.body.versionId).toBe(versionId);
  });

  it.each([
    ["negative second", { second: -1, body: "x" }],
    ["non-numeric second", { second: "ten", body: "x" }],
    ["missing second", { body: "x" }],
    ["empty body", { second: 5, body: "" }],
    ["missing body", { second: 5 }],
  ])("rejects invalid comment with 400: %s", async (_, payload) => {
    const a = createApp();
    const versionId = await versionFor(a);
    const res = await request(a).post(`/versions/${versionId}/comments`).send(payload);
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown version on create and list", async () => {
    const a = createApp();
    expect(
      (await request(a).post("/versions/nope/comments").send({ second: 1, body: "x" })).status,
    ).toBe(404);
    expect((await request(a).get("/versions/nope/comments")).status).toBe(404);
  });

  it("lists only the requested version's comments; fresh version lists [] with 200", async () => {
    const a = createApp();
    const versionId = await versionFor(a);
    const fresh = await request(a).get(`/versions/${versionId}/comments`);
    expect(fresh.status).toBe(200);
    expect(fresh.body).toEqual([]);

    await request(a).post(`/versions/${versionId}/comments`).send({ second: 3, body: "old note" });

    const camp = await request(a).post("/campaigns").send({ requiredPieces: ["video"] });
    const del = await request(a).post("/deliveries").send({ campaignId: camp.body.id });
    const v2 = await request(a)
      .post(`/deliveries/${del.body.id}/versions`)
      .send({ piece: "video", contentUrl: "http://x/v2.mp4" });

    const list = await request(a).get(`/versions/${versionId}/comments`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].body).toBe("old note");

    const other = await request(a).get(`/versions/${v2.body.id}/comments`);
    expect(other.status).toBe(200);
    expect(other.body).toEqual([]);
  });
});
