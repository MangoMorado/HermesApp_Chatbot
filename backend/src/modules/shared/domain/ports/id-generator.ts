/** Puerto de identificadores: el nucleo no decide como se generan los IDs. */
export type IdGenerator = {
  next(): string;
};
