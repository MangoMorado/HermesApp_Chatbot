/** La plataforma audita con identidad fija: no es un usuario ni pertenece a un tenant. */
export const PLATFORM_AUDIT_ACTOR = { actorSubject: "platform", actorRole: "platform" } as const;
