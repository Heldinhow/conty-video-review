import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizePiece, validateRequiredPieces } from "./domain/pieces.js";
import { getMissingPieces, isDeliveryApproved } from "./domain/rules.js";
import {
  campaigns,
  comments,
  deliveries,
  nextId,
  versions,
} from "./store.js";

// Uploads live next to the project root (one level above this module),
// never under process.cwd(); UPLOAD_DIR overrides explicitly.
export function resolveUploadDir(): string {
  if (process.env.UPLOAD_DIR) return path.resolve(process.env.UPLOAD_DIR);
  return path.resolve(__dirname, "..", "uploads");
}

export function createApp() {
  const app = express();
  app.use(express.json());

  const uploadDir = resolveUploadDir();
  fs.mkdirSync(uploadDir, { recursive: true });
  // Memory storage: the file only hits disk after delivery/piece validation
  // passes, so rejections never leave orphans behind.
  const upload = multer({ storage: multer.memoryStorage() });

  app.get("/files/:nome", (req, res) => {
    // basename blocks path traversal; unknown names fall through to 404.
    res.sendFile(path.join(uploadDir, path.basename(req.params.nome)), (err) => {
      if (err) res.status(404).json({ error: "file not found" });
    });
  });

  app.post("/campaigns", (req, res) => {
    const required = validateRequiredPieces(req.body?.requiredPieces);
    if (!required) return res.status(400).json({ error: "invalid requiredPieces" });
    const id = nextId();
    campaigns.set(id, { id, requiredPieces: required });
    return res.status(201).json({ id, requiredPieces: required });
  });

  app.post("/deliveries", (req, res) => {
    const campaign = campaigns.get(req.body?.campaignId);
    if (!campaign) return res.status(404).json({ error: "campaign not found" });
    const id = nextId();
    deliveries.set(id, { id, campaignId: campaign.id, currentByPiece: new Map() });
    const missing = getMissingPieces(campaign.requiredPieces, new Map());
    return res.status(201).json({ id, campaignId: campaign.id, approved: false, missing });
  });

  app.get("/deliveries/:id", (req, res) => {
    const delivery = deliveries.get(req.params.id);
    if (!delivery) return res.status(404).json({ error: "delivery not found" });
    const campaign = campaigns.get(delivery.campaignId);
    if (!campaign) return res.status(404).json({ error: "campaign not found" });
    const missing = getMissingPieces(campaign.requiredPieces, delivery.currentByPiece);
    return res.json({
      id: delivery.id,
      campaignId: delivery.campaignId,
      approved: isDeliveryApproved(campaign.requiredPieces, delivery.currentByPiece),
      missing,
      currentVersions: Object.fromEntries(delivery.currentByPiece),
    });
  });

  app.post("/deliveries/:id/versions", upload.single("file"), (req, res) => {
    const delivery = deliveries.get(req.params.id);
    if (!delivery) return res.status(404).json({ error: "delivery not found" });
    const piece = normalizePiece(req.body?.piece);
    if (!piece) return res.status(400).json({ error: "invalid piece" });
    // Binary upload wins when present; persist only after validation passed.
    let contentUrl: unknown = req.body?.contentUrl;
    if (req.file) {
      const name = `${randomUUID()}${path.extname(req.file.originalname)}`;
      fs.writeFileSync(path.join(uploadDir, path.basename(name)), req.file.buffer);
      contentUrl = `/files/${name}`;
    }
    if (typeof contentUrl !== "string" || contentUrl.trim() === "") {
      return res.status(400).json({ error: "invalid contentUrl" });
    }
    // Always born pending; client-sent status is ignored so the rule can't be bypassed.
    const id = nextId();
    versions.set(id, { id, deliveryId: delivery.id, piece, contentUrl, status: "pending" });
    delivery.currentByPiece.set(piece, { status: "pending", versionId: id });
    return res.status(201).json({ id, deliveryId: delivery.id, piece, contentUrl, status: "pending" });
  });

  app.get("/versions/:id", (req, res) => {
    const version = versions.get(req.params.id);
    if (!version) return res.status(404).json({ error: "version not found" });
    return res.json({ id: version.id, deliveryId: version.deliveryId, piece: version.piece, contentUrl: version.contentUrl, status: version.status });
  });

  app.post("/versions/:id/approve", (req, res) => {
    const version = versions.get(req.params.id);
    if (!version) return res.status(404).json({ error: "version not found" });
    const delivery = deliveries.get(version.deliveryId);
    if (!delivery) return res.status(404).json({ error: "delivery not found" });
    const current = delivery.currentByPiece.get(version.piece);
    if (!current || current.versionId !== version.id) {
      return res.status(422).json({ error: "superseded" });
    }
    version.status = "approved";
    current.status = "approved";
    return res.json({ id: version.id, deliveryId: version.deliveryId, piece: version.piece, contentUrl: version.contentUrl, status: "approved" });
  });

  app.post("/deliveries/:id/approve", (req, res) => {
    const delivery = deliveries.get(req.params.id);
    if (!delivery) return res.status(404).json({ error: "delivery not found" });
    const campaign = campaigns.get(delivery.campaignId);
    if (!campaign) return res.status(404).json({ error: "campaign not found" });
    const missing = getMissingPieces(campaign.requiredPieces, delivery.currentByPiece);
    if (missing.length > 0) return res.status(422).json({ missing });
    return res.json({ id: delivery.id, campaignId: delivery.campaignId, approved: true, missing: [] });
  });

  app.post("/versions/:id/comments", (req, res) => {
    const version = versions.get(req.params.id);
    if (!version) return res.status(404).json({ error: "version not found" });
    const second = req.body?.second;
    if (typeof second !== "number" || !Number.isFinite(second) || second < 0) {
      return res.status(400).json({ error: "invalid second" });
    }
    const body = req.body?.body;
    if (typeof body !== "string" || body.trim() === "") {
      return res.status(400).json({ error: "invalid body" });
    }
    const id = nextId();
    const comment = { id, versionId: version.id, second, body };
    comments.set(version.id, [...(comments.get(version.id) ?? []), comment]);
    return res.status(201).json(comment);
  });

  app.get("/versions/:id/comments", (req, res) => {
    if (!versions.get(req.params.id)) {
      return res.status(404).json({ error: "version not found" });
    }
    return res.json(comments.get(req.params.id) ?? []);
  });

  // Multer rejections (e.g. unexpected field) are client errors, not 500s.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `invalid upload: ${err.code}` });
    }
    return next(err);
  });

  return app;
}
