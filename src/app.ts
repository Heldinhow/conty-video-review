import express from "express";
import { validateRequiredPieces } from "./domain/pieces.js";
import { getMissingPieces, isDeliveryApproved } from "./domain/rules.js";
import {
  campaigns,
  deliveries,
  nextId,
} from "./store.js";

export function createApp() {
  const app = express();
  app.use(express.json());

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

  return app;
}
