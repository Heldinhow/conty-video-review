import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetStore } from "../src/store";

beforeEach(() => resetStore());

async function deliveryFor(a: ReturnType<typeof createApp>) {
  const camp = await request(a).post("/campaigns").send({ requiredPieces: ["video"] });
  expect(camp.status).toBe(201);
  const del = await request(a).post("/deliveries").send({ campaignId: camp.body.id });
  expect(del.status).toBe(201);
  return del.body.id as string;
}

describe("ticket 05: real file upload and serving", () => {
  it("accepts multipart file upload; version points at /files/:nome and the file serves back", async () => {
    const a = createApp();
    const deliveryId = await deliveryFor(a);
    const payload = Buffer.from("fake-video-bytes");
    const up = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .field("piece", "video")
      .attach("file", payload, "clip.mp4");
    expect(up.status).toBe(201);
    expect(up.body.piece).toBe("video");
    expect(up.body.status).toBe("pending");
    expect(typeof up.body.contentUrl).toBe("string");
    expect(up.body.contentUrl).toMatch(/^\/files\/.+/);

    const got = await request(a).get(up.body.contentUrl);
    expect(got.status).toBe(200);
    expect(Buffer.from(got.body as unknown as ArrayBuffer).toString()).toBe("fake-video-bytes");
  });

  it("keeps the JSON contentUrl path working", async () => {
    const a = createApp();
    const deliveryId = await deliveryFor(a);
    const res = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .send({ piece: "video", contentUrl: "http://x/v1.mp4" });
    expect(res.status).toBe(201);
    expect(res.body.contentUrl).toBe("http://x/v1.mp4");
  });

  it("returns 404 for unknown files", async () => {
    const a = createApp();
    const res = await request(a).get("/files/no-such-file.mp4");
    expect(res.status).toBe(404);
  });
});
