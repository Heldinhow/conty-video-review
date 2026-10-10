import type { Piece } from "./domain/pieces.js";
import type { VersionStatus } from "./domain/rules.js";

export interface Campaign {
  id: string;
  requiredPieces: Piece[];
}

export interface Delivery {
  id: string;
  campaignId: string;
  // Piece -> current version status. Empty until ticket 03 submits versions.
  currentByPiece: Map<Piece, { status: VersionStatus }>;
}

let counter = 1;
export const campaigns = new Map<string, Campaign>();
export const deliveries = new Map<string, Delivery>();

export function nextId(): string {
  return String(counter++);
}

export function resetStore(): void {
  campaigns.clear();
  deliveries.clear();
  counter = 1;
}
