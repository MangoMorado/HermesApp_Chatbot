import { defineConfig } from "react-doctor/api";

/**
 * Fase 2: el JWT se pega en sessionStorage a propósito (sin emisión de producto).
 * Fase 3 introduce cookies HttpOnly; hasta entonces esta regla queda off.
 */
export default defineConfig({
  ignore: {
    files: ["src/api/**", "src/sim/**", "src/platform/**", "src/widget/api/**", "public/widget.js"],
  },
  rules: {
    "react-doctor/auth-token-in-web-storage": "off",
  },
});
