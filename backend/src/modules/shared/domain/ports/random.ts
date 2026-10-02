/** Puerto de azar: el nucleo nunca llama a Math.random ni a node:crypto. */
export type Random = {
  /** Entero uniforme en [0, maxExclusive). */
  int(maxExclusive: number): number;
};
