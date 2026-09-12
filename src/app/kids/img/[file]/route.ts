/**
 * Sert la capture d'une piece Gen Kids : /kids/img/<id>.png
 *
 * Le contrat v2 annonce cette adresse dans le champ `image` de chaque
 * token. Les fichiers vivent dans le bucket Supabase public `kids`,
 * dossier `img/` ; cette route les relaie, avec un cache long : une
 * capture ne change pas, et OpenSea ne doit jamais tomber sur une
 * absence. Le domaine reste le notre, le stockage peut changer.
 */
import { serveKidsImage } from "@/lib/kids/image";

export const runtime = "edge";

export function GET(_req: Request, ctx: { params: { file: string } }) {
  return serveKidsImage("img", ctx.params.file);
}
