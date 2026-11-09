import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Swagger UI (/docs) lee sus activos del paquete en tiempo de ejecucion: deben viajar en standalone.
  outputFileTracingIncludes: {
    "/docs/**": ["./node_modules/swagger-ui-dist/**/*"],
  },
  reactStrictMode: true,
};

export default nextConfig;
