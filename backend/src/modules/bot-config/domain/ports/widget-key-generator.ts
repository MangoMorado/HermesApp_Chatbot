/** Puerto: el nucleo no sabe de donde sale la aleatoriedad de la clave. */
export type WidgetKeyGenerator = {
  next(): string;
};
