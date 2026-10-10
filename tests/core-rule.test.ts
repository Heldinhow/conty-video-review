import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetStore } from "../src/store";

beforeEach(() => resetStore());

async function campaignWith(a: ReturnType<typeof createApp>, requiredPieces: string[]) {
  const res = await request(a).post("/campaigns").send({ requiredPieces });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function deliveryFor(a: ReturnType<typeof createApp>, campaignId: string) {
  const res = await request(a).post("/deliveries").send({ campaignId });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("ticket 03: core rule — versions and approvals", () => {
  it("submits a version as pending even when the client sends status approved", async () => {
    const a = createApp();
    const campaignId = await campaignWith(a, ["video"]);
    const deliveryId = await deliveryFor(a, campaignId);
    const res = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .send({ piece: "video", contentUrl: "http://x/v1.mp4", status: "approved" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.piece).toBe("video");
  });

  it("approves versions then the delivery (200); re-approving a version is 200 idempotent", async () => {
    const a = createApp();
    const campaignId = await campaignWith(a, ["video"]);
    const deliveryId = await deliveryFor(a, campaignId);
    const v = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .send({ piece: "video", contentUrl: "http://x/v1.mp4" });
    const approve = await request(a).post(`/versions/${v.body.id}/approve`);
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");

    const again = await request(a).post(`/versions/${v.body.id}/approve`);
    expect(again.status).toBe(200);

    const done = await request(a).post(`/deliveries/${deliveryId}/approve`);
    expect(done.status).toBe(200);
    expect(done.body.approved).toBe(true);
  });

  it("rejects delivery approval with 422 listing missing pieces; zero versions means all missing", async () => {
    const a = createApp();
    const campaignId = await campaignWith(a, ["roteiro", "video"]);
    const deliveryId = await deliveryFor(a, campaignId);
    const res = await request(a).post(`/deliveries/${deliveryId}/approve`);
    expect(res.status).toBe(422);
    expect(res.body.missing).toEqual(["roteiro", "video"]);
  });

  it("lists only the still-missing pieces after a partial approval", async () => {
    const a = createApp();
    const campaignId = await campaignWith(a, ["roteiro", "video"]);
    const deliveryId = await deliveryFor(a, campaignId);
    const v = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .send({ piece: "video", contentUrl: "http://x/v1.mp4" });
    await request(a).post(`/versions/${v.body.id}/approve`);
    const res = await request(a).post(`/deliveries/${deliveryId}/approve`);
    expect(res.status).toBe(422);
    expect(res.body.missing).toEqual(["roteiro"]);
  });

  it("approves a video-only delivery without roteiro", async () => {
    const a = createApp();
    const campaignId = await campaignWith(a, ["video"]);
    const deliveryId = await deliveryFor(a, campaignId);
    const v = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .send({ piece: "video", contentUrl: "http://x/v1.mp4" });
    await request(a).post(`/versions/${v.body.id}/approve`);
    const res = await request(a).post(`/deliveries/${deliveryId}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);
  });

  it("accepts submit/approve of a non-required piece (200) but it never blocks the rule", async () => {
    const a = createApp();
    const campaignId = await campaignWith(a, ["video"]);
    const deliveryId = await deliveryFor(a, campaignId);
    const extra = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .send({ piece: "roteiro", contentUrl: "http://x/r1.txt" });
    expect(extra.status).toBe(201);
    const approved = await request(a).post(`/versions/${extra.body.id}/approve`);
    expect(approved.status).toBe(200);
    const blocked = await request(a).post(`/deliveries/${deliveryId}/approve`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.missing).toEqual(["video"]);
  });

  it("rejects approving a non-current version with 422 superseded and leaves the delivery untouched", async () => {
    const a = createApp();
    const campaignId = await campaignWith(a, ["video"]);
    const deliveryId = await deliveryFor(a, campaignId);
    const v1 = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .send({ piece: "video", contentUrl: "http://x/v1.mp4" });
    await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .send({ piece: "video", contentUrl: "http://x/v2.mp4" });
    const res = await request(a).post(`/versions/${v1.body.id}/approve`);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/superseded/);
    const view = await request(a).get(`/deliveries/${deliveryId}`);
    expect(view.body.approved).toBe(false);
    expect(view.body.missing).toEqual(["video"]);
  });

  it("normalizes piece case/accent on submit (VÍDEO -> video)", async () => {
    const a = createApp();
    const campaignId = await campaignWith(a, ["video"]);
    const deliveryId = await deliveryFor(a, campaignId);
    const res = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .send({ piece: "VÍDEO", contentUrl: "http://x/v1.mp4" });
    expect(res.status).toBe(201);
    expect(res.body.piece).toBe("video");
  });

  it("returns 400 for off-enum piece or missing contentUrl on submit", async () => {
    const a = createApp();
    const campaignId = await campaignWith(a, ["video"]);
    const deliveryId = await deliveryFor(a, campaignId);
    const badPiece = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .send({ piece: "edicao", contentUrl: "http://x/v1.mp4" });
    expect(badPiece.status).toBe(400);
    const noUrl = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .send({ piece: "video" });
    expect(noUrl.status).toBe(400);
  });

  it("returns 404 for unknown delivery/version ids", async () => {
    const a = createApp();
    expect((await request(a).post("/deliveries/nope/versions").send({ piece: "video", contentUrl: "http://x" })).status).toBe(404);
    expect((await request(a).post("/versions/nope/approve")).status).toBe(404);
    expect((await request(a).post("/deliveries/nope/approve")).status).toBe(404);
  });
});
