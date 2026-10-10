import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp, resolveUploadDir } from "../src/app";
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

describe("ticket 08: review fixes — upload dir and multipart handling", () => {
  const prevUploadDir = process.env.UPLOAD_DIR;
  afterEach(() => {
    if (prevUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = prevUploadDir;
  });

  it("anchors uploads to the project root, not process.cwd()", async () => {
    const prevCwd = process.cwd();
    process.chdir(os.tmpdir());
    try {
      const a = createApp();
      const deliveryId = await deliveryFor(a);
      const up = await request(a)
        .post(`/deliveries/${deliveryId}/versions`)
        .field("piece", "video")
        .attach("file", Buffer.from("cwd-proof"), "clip.mp4");
      expect(up.status).toBe(201);
      const name = (up.body.contentUrl as string).replace("/files/", "");
      // Served file lives under the resolved (project-root) dir, never under cwd.
      expect(fs.existsSync(path.join(resolveUploadDir(), name))).toBe(true);
      expect(fs.existsSync(path.join(os.tmpdir(), "uploads", name))).toBe(false);
      const got = await request(a).get(up.body.contentUrl);
      expect(got.status).toBe(200);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("honors an explicit UPLOAD_DIR override", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-uploads-"));
    process.env.UPLOAD_DIR = dir;
    const a = createApp();
    const deliveryId = await deliveryFor(a);
    const up = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .field("piece", "video")
      .attach("file", Buffer.from("override-proof"), "clip.mp4");
    expect(up.status).toBe(201);
    const name = (up.body.contentUrl as string).replace("/files/", "");
    expect(fs.existsSync(path.join(dir, name))).toBe(true);
  });

  it("leaves no orphan file when delivery/piece validation rejects the upload", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-orphan-"));
    process.env.UPLOAD_DIR = dir;
    const a = createApp();
    expect(resolveUploadDir()).toBe(dir);
    const deliveryId = await deliveryFor(a);
    const badPiece = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .field("piece", "edicao")
      .attach("file", Buffer.from("orphan-bytes"), "clip.mp4");
    expect(badPiece.status).toBe(400);
    const unknownDelivery = await request(a)
      .post("/deliveries/nope/versions")
      .field("piece", "video")
      .attach("file", Buffer.from("orphan-bytes"), "clip.mp4");
    expect(unknownDelivery.status).toBe(404);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("maps unexpected upload fields to 400, not 500", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-field-"));
    process.env.UPLOAD_DIR = dir;
    const a = createApp();
    const deliveryId = await deliveryFor(a);
    const res = await request(a)
      .post(`/deliveries/${deliveryId}/versions`)
      .field("piece", "video")
      .attach("wrong", Buffer.from("x"), "clip.mp4");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/upload|field|file/i);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
