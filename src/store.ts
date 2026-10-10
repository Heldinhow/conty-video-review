import type { Piece } from "./domain/pieces.js";
import type { VersionStatus } from "./domain/rules.js";

export interface Campaign {
  id: string;
  requiredPieces: Piece[];
}

export interface Delivery {
  id: string;
  campaignId: string;
  // Piece -> current version pointer. Status mirrors the current Version's
  // status so the pure rule module keeps reading this map directly.
  currentByPiece: Map<Piece, { status: VersionStatus; versionId: string }>;
}

export interface Version {
  id: string;
  deliveryId: string;
  piece: Piece;
  contentUrl: string;
  status: VersionStatus;
}

let counter = 1;
export const campaigns = new Map<string, Campaign>();
export const deliveries = new Map<string, Delivery>();
// Append-only history; Delivery.currentByPiece.versionId is the live pointer.
export const versions = new Map<string, Version>();

export function nextId(): string {
  return String(counter++);
}

export function resetStore(): void {
  campaigns.clear();
  deliveries.clear();
  versions.clear();
  counter = 1;
}
