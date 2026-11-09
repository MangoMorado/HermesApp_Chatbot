/**
 * Pares (operacion, status) declarados que `contrato-rutas` no reproduce, cada uno con su
 * motivo. Clave: `"<surface> <METHOD> <path>"`. Una exencion sin motivo rompe la suite.
 */
export const EXEMPTIONS: Readonly<Record<string, Readonly<Partial<Record<number, string>>>>> = {};
