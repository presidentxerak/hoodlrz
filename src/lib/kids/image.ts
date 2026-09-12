/**
 * Relais des captures Gen Kids depuis le stockage Supabase.
 *
 * Seuls des noms de fichiers simples sont acceptes (`123.png`,
 * `collection.png`) : la route ne doit jamais servir de proxy generique.
 */
export async function serveKidsImage(dir: "img" | "img-testnet", file: string): Promise<Response> {
  if (!/^(\d{1,5}|collection)\.png$/.test(file)) {
    return new Response("Not found", { status: 404 });
  }
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!base) return new Response("Storage not configured", { status: 503 });

  const upstream = await fetch(`${base}/storage/v1/object/public/kids/${dir}/${file}`, {
    // Le CDN de Vercel garde la reponse un an : une capture est immuable.
    next: { revalidate: 31536000 },
  });
  if (!upstream.ok) return new Response("Not found", { status: upstream.status === 400 ? 404 : upstream.status });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
    },
  });
}
