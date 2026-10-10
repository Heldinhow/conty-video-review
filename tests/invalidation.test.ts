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

async function submit(a: ReturnType<typeof createApp>, deliveryId: string, piece: string, contentUrl: string) {
  const res = await request(a)
    .post(`/deliveries/${deliveryId}/versions`)
    .send({ piece, contentUrl });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function approveVersion(a: ReturnType<typeof createApp>, versionId: string) {
  const res = await request(a).post(`/versions/${versionId}/approve`);
  expect(res.status).toBe(200);
  return res;
}

// Builds a fully approved delivery and returns its version id.
async function approvedDelivery(a: ReturnType<typeof createApp>, requiredPieces: string[]) {
  const campaignId = await campaignWith(a, requiredPieces);
  const deliveryId = await deliveryFor(a, campaignId);
  const versionIds: string[] = [];
  for (const piece of requiredPieces) {
    versionIds.push(await submit(a, deliveryId, piece, `http://x/${piece}-v1`));
  }
  for (const id of versionIds) await approveVersion(a, id);
  const done = await request(a).post(`/deliveries/${deliveryId}/approve`);
  expect(done.status).toBe(200);
  expect(done.body.approved).toBe(true);
  return { deliveryId, versionIds };
}

describe("ticket 04: new version revokes delivery approval", () => {
  it("new version on a required piece of an approved delivery revokes approval, visible via GET with the piece missing", async () => {
    const a = createApp();
    const { deliveryId } = await approvedDelivery(a, ["video"]);

    await submit(a, deliveryId, "video", "http://x/video-v2");

    const view = await request(a).get(`/deliveries/${deliveryId}`);
    expect(view.status).toBe(200);
    expect(view.body.approved).toBe(false);
    expect(view.body.missing).toEqual(["video"]);
  });

  it("new version on a non-required piece leaves approval untouched", async () => {
    const a = createApp();
    const { deliveryId } = await approvedDelivery(a, ["video"]);

    const extra = await submit(a, deliveryId, "roteiro", "http://x/roteiro-v1");
    expect(extra).toBeTruthy();

    const view = await request(a).get(`/deliveries/${deliveryId}`);
    expect(view.status).toBe(200);
    expect(view.body.approved).toBe(true);
    expect(view.body.missing).toEqual([]);
  });

  it("versions are append-only: old versions stay readable via GET /versions/:id and only the current pointer moves", async () => {
    const a = createApp();
    const { deliveryId, versionIds } = await approvedDelivery(a, ["video"]);
    const [v1] = versionIds;

    const v2 = await submit(a, deliveryId, "video", "http://x/video-v2");

    const old = await request(a).get(`/versions/${v1}`);
    expect(old.status).toBe(200);
    expect(old.body).toMatchObject({
      id: v1,
      deliveryId,
      piece: "video",
      contentUrl: "http://x/video-v1",
      status: "approved",
    });

    const current = await request(a).get(`/versions/${v2}`);
    expect(current.status).toBe(200);
    expect(current.body).toMatchObject({ id: v2, status: "pending" });

    const view = await request(a).get(`/deliveries/${deliveryId}`);
    expect(view.body.currentVersions.video.versionId).toBe(v2);

    expect((await request(a).get("/versions/nope")).status).toBe(404);
  });

  it("re-approving the new version restores delivery approval", async () => {
    const a = createApp();
    const { deliveryId } = await approvedDelivery(a, ["video"]);

    const v2 = await submit(a, deliveryId, "video", "http://x/video-v2");
    await approveVersion(a, v2);

    const view = await request(a).get(`/deliveries/${deliveryId}`);
    expect(view.body.approved).toBe(true);
    expect(view.body.missing).toEqual([]);

    const done = await request(a).post(`/deliveries/${deliveryId}/approve`);
    expect(done.status).toBe(200);
    expect(done.body.approved).toBe(true);
  });
});
