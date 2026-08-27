import type {NextConfig} from "next";

const nextConfig: NextConfig = {
  // @0g-delphi/protocol mengekspor .ts mentah, bukan JS terkompilasi.
  // Tanpa ini, build gagal saat mengimpor cermin DPM.
  transpilePackages: ["@0g-delphi/protocol"],
};

export default nextConfig;
