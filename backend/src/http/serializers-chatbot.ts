import type { BotConfigView } from "@/modules/bot-config/application/bot-config";
import type { WidgetKey } from "@/modules/bot-config/domain/widget-key";
import type { KnowledgeEntry } from "@/modules/knowledge/domain/knowledge-entry";
import type { TenantSummary } from "@/modules/platform/domain/tenant-registration";

function widgetKeyJson(key: WidgetKey | null) {
  if (!key) {
    return null;
  }
  return {
    key: key.key,
    created_at: key.createdAt.toISOString(),
    grace_until: key.graceUntil?.toISOString() ?? null,
  };
}

export function botConfigJson(view: BotConfigView) {
  return {
    texts: view.config.texts,
    params: view.config.params,
    allowed_origins: view.config.allowedOrigins,
    widget_keys: { current: widgetKeyJson(view.currentKey), grace: widgetKeyJson(view.graceKey) },
  };
}

export function tenantJson(tenant: TenantSummary) {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    created_at: tenant.createdAt.toISOString(),
  };
}

export function knowledgeEntryJson(entry: KnowledgeEntry) {
  return {
    id: entry.id,
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
    detail: entry.detail,
    keywords: [...entry.keywords],
    position: entry.position,
    active: entry.active,
  };
}
