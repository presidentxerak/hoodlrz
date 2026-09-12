/** Meme chose que /kids/img, pour la collection de test. */
import { serveKidsImage } from "@/lib/kids/image";

export const runtime = "edge";

export function GET(_req: Request, ctx: { params: { file: string } }) {
  return serveKidsImage("img-testnet", ctx.params.file);
}
