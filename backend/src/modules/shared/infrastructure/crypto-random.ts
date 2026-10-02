import { randomInt } from "node:crypto";
import type { Random } from "../domain/ports/random";

export const cryptoRandom: Random = { int: (maxExclusive) => randomInt(maxExclusive) };
