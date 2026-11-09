import { defineConfig } from "react-doctor/api";

/**
 * Fase 5.2: la sesión OIDC (cliente público con PKCE) vive en sessionStorage por pestaña, como
 * hace `oidc-client-ts` por defecto. Moverla a memoria o a un BFF es endurecimiento de la Fase 6.
 */
export default defineConfig({
  ignore: {
    files: ["src/api/**", "src/sim/**", "src/platform/**", "src/widget/api/**", "public/widget.js"],
  },
  rules: {
    "react-doctor/auth-token-in-web-storage": "off",
  },
});
