export type Piece = "roteiro" | "video" | "capa" | "legenda";

const CANONICAL: Piece[] = ["roteiro", "video", "capa", "legenda"];

// Case-insensitive, accent optional ("vídeo" -> "video").
export function normalizePiece(raw: unknown): Piece | null {
  if (typeof raw !== "string") return null;
  const folded = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return (CANONICAL as string[]).includes(folded) ? (folded as Piece) : null;
}

export function validateRequiredPieces(raw: unknown): Piece[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Piece[] = [];
  for (const item of raw) {
    const p = normalizePiece(item);
    if (!p) return null;
    if (out.includes(p)) return null; // duplicated (after normalization)
    out.push(p);
  }
  return out;
}
