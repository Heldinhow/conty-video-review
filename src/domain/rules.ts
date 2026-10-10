import type { Piece } from "./pieces.js";

// Minimal shape the rule needs. Later tickets extend Version with
// contentUrl/comments without changing these signatures: the rule only
// reads currentByPiece (piece -> current version status).
export type VersionStatus = "pending" | "approved";

export function getMissingPieces(
  required: Piece[],
  currentByPiece: Map<Piece, { status: VersionStatus }>,
): Piece[] {
  return required.filter((p) => currentByPiece.get(p)?.status !== "approved");
}

export function isDeliveryApproved(
  required: Piece[],
  currentByPiece: Map<Piece, { status: VersionStatus }>,
): boolean {
  return getMissingPieces(required, currentByPiece).length === 0;
}
