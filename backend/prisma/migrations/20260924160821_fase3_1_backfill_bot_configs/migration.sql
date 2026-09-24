-- Backfill: los tenants dados de alta antes de esta migracion (seed y despliegues previos)
-- no tienen fila en bot_configs, asi que GET/PATCH /bot-config y el rotate de la clave del
-- widget les responden 404. Provision con los predeterminados (sin origenes ni textos):
-- ON CONFLICT DO NOTHING para no pisar la fila de un tenant dado de alta despues.
INSERT INTO "bot_configs" ("tenant_id", "updated_at")
SELECT "id", now() FROM "tenants"
ON CONFLICT ("tenant_id") DO NOTHING;
