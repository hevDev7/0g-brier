import type {NextConfig} from "next";

/**
 * Hostnames allowed to reach the dev server through a reverse proxy or tunnel.
 *
 * Next blocks cross-origin requests to dev-only endpoints — `/_next/*` assets
 * and the HMR socket — so a tunnelled host serves the first HTML and then
 * stalls: no styles, no refresh. Only the hostname belongs here, no scheme.
 *
 * Read from `DEV_ALLOWED_HOSTS` (comma-separated) rather than hardcoded, so no
 * single person's tunnel domain is baked into the repo and every reviewer can
 * point their own at it. Next loads `.env.local` before evaluating this file,
 * which is where the value belongs on a development machine.
 *
 * The companion half is the dev port: `npm run dev` pins `-p 3003` so the
 * tunnel has a target that cannot drift. Without an explicit `-p`, Next walks
 * up from 3000 to the first free port, which silently changes which server the
 * tunnel is pointing at whenever another project starts first.
 */
const allowedDevOrigins = (process.env.DEV_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // @brier/protocol exports raw .ts, not compiled JS. Without this, the
  // build fails when importing the DPM mirror.
  transpilePackages: ["@brier/protocol"],
  allowedDevOrigins,
};

export default nextConfig;
