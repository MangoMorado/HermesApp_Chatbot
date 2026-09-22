/** Puerto de reloj: el nucleo nunca lee la hora del sistema por su cuenta. */
export type Clock = {
  now(): Date;
};
