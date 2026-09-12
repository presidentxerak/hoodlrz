/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  // Les captures des pieces Gen Kids vivent sur le stockage Supabase ;
  // le contrat n'annonce que notre domaine, pour que le stockage puisse
  // changer sans toucher a la chaine.
  async rewrites() {
    const sb = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
    if (!sb) return [];
    return ["img", "img-testnet"].map((dir) => ({
      source: `/kids/${dir}/:path*`,
      destination: `${sb}/storage/v1/object/public/kids/${dir}/:path*`,
    }));
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
};

export default nextConfig;
