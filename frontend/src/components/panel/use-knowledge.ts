"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  listKnowledgeEntries,
  updateKnowledgeEntry,
} from "@/api/default/default";
import type { KnowledgeEntry } from "@/api/models";
import { idempotent } from "@/lib/idempotency";
import { draftOf, EMPTY_DRAFT, inputOf } from "@/lib/knowledge-draft";
import { useAction } from "@/lib/use-action";
import { useToken } from "@/lib/use-session";

const PAGE_SIZE = 100;

/** Lista paginada por cursor y formulario de alta/edición; cada escritura lleva su clave. */
export function useKnowledge() {
  const token = useToken();
  const list = useInfiniteQuery({
    queryKey: ["knowledge-entries", token?.slice(-16) ?? null],
    queryFn: ({ pageParam }) =>
      listKnowledgeEntries({ limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(token),
    retry: false,
  });
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [picked, setPicked] = useState("");
  const [armed, setArmed] = useState(false);
  const action = useAction();
  const entries = list.data
    ? list.data.pages.flatMap((page) => page.data as KnowledgeEntry[])
    : null;

  const reset = () => {
    setPicked("");
    setArmed(false);
    setDraft(EMPTY_DRAFT);
  };
  const settle = async () => {
    reset();
    await list.refetch();
  };

  return {
    ...action,
    list,
    entries,
    draft,
    setDraft,
    picked,
    armed,
    setArmed,
    reset,
    /** Elegir la fila ya elegida la suelta y vuelve al alta. */
    pick(id: string) {
      const entry = entries?.find((item) => item.id === id);
      if (!entry || id === picked) {
        reset();
        return;
      }
      setPicked(id);
      setArmed(false);
      setDraft(draftOf(entry));
    },
    save: () =>
      action.run("save", async () => {
        const input = inputOf(draft);
        if (picked) {
          await updateKnowledgeEntry(picked, input, idempotent(`kb.update:${picked}`, input));
        } else {
          await createKnowledgeEntry(input, idempotent("kb.create", input));
        }
        await settle();
      }),
    remove: () =>
      action.run("delete", async () => {
        await deleteKnowledgeEntry(picked, idempotent(`kb.delete:${picked}`, {}));
        await settle();
      }),
  };
}

export type Knowledge = ReturnType<typeof useKnowledge>;
