import type { HandoffTicket } from "./handoff-ticket";

export type HandoffRepository = { insert(ticket: HandoffTicket): Promise<void> };
