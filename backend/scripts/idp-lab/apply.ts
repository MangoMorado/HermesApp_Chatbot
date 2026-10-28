/** Reconciliador: GET y luego crear o actualizar. Una segunda ejecucion no crea nada. */
import type { AdminClient, Json } from "./admin-client";
import type { ClientPlan, LabPlan, MapperPlan, UserPlan } from "./plan";

export type ApplyOptions = { userPassword: string; serviceSecret: string };
export type ApplyResult = {
  created: string[];
  clientSecrets: Record<string, string>;
};

type Ctx = { admin: AdminClient; realm: string; created: string[]; options: ApplyOptions };

const asList = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);
const enc = encodeURIComponent;

async function ensureRealm(ctx: Ctx, plan: LabPlan): Promise<void> {
  const desired = {
    realm: plan.realm.name,
    enabled: true,
    accessTokenLifespan: plan.realm.accessTokenLifespan,
  };
  const current = (await ctx.admin.get(`/${ctx.realm}`)) as Json | null;
  if (current) {
    await ctx.admin.put(`/${ctx.realm}`, { ...current, ...desired });
    return;
  }
  await ctx.admin.post("", desired);
  ctx.created.push(`realm:${ctx.realm}`);
}

async function ensureUserProfile(ctx: Ctx, plan: LabPlan): Promise<void> {
  const path = `/${ctx.realm}/users/profile`;
  const profile = (await ctx.admin.get(path)) as { attributes?: Json[] } & Json;
  const attributes = profile.attributes ?? [];
  const missing = plan.userProfileAttributes.filter((n) => !attributes.some((a) => a.name === n));
  if (missing.length === 0) return;
  const added = missing.map((name) => ({
    name,
    displayName: name,
    permissions: { view: ["admin"], edit: ["admin"] },
    validations: {},
  }));
  await ctx.admin.put(path, { ...profile, attributes: [...attributes, ...added] });
  ctx.created.push(...missing.map((n) => `user-profile:${n}`));
}

async function ensureRoles(ctx: Ctx, plan: LabPlan): Promise<void> {
  for (const name of plan.roles) {
    if (await ctx.admin.get(`/${ctx.realm}/roles/${enc(name)}`)) continue;
    await ctx.admin.post(`/${ctx.realm}/roles`, { name });
    ctx.created.push(`role:${name}`);
  }
}

async function ensureMappers(ctx: Ctx, basePath: string, mappers: MapperPlan[]): Promise<void> {
  const existing = asList(await ctx.admin.get(`${basePath}/protocol-mappers/models`));
  for (const mapper of mappers) {
    const body = {
      name: mapper.name,
      protocol: "openid-connect",
      protocolMapper: mapper.type,
      config: mapper.config,
    };
    const found = existing.find((m) => m.name === mapper.name);
    if (found) {
      await ctx.admin.put(`${basePath}/protocol-mappers/models/${found.id}`, {
        ...body,
        id: found.id,
      });
    } else {
      await ctx.admin.post(`${basePath}/protocol-mappers/models`, body);
      ctx.created.push(`mapper:${basePath}:${mapper.name}`);
    }
  }
}

async function findScope(ctx: Ctx, name: string): Promise<Json | undefined> {
  return asList(await ctx.admin.get(`/${ctx.realm}/client-scopes`)).find((s) => s.name === name);
}

async function ensureScope(ctx: Ctx, plan: LabPlan): Promise<string> {
  const { name, mappers } = plan.clientScope;
  const body = {
    name,
    protocol: "openid-connect",
    attributes: { "include.in.token.scope": "false" },
  };
  let scope = await findScope(ctx, name);
  if (scope) {
    await ctx.admin.put(`/${ctx.realm}/client-scopes/${scope.id}`, { ...scope, ...body });
  } else {
    await ctx.admin.post(`/${ctx.realm}/client-scopes`, body);
    ctx.created.push(`scope:${name}`);
    scope = await findScope(ctx, name);
  }
  const id = String(scope?.id);
  await ensureMappers(ctx, `/${ctx.realm}/client-scopes/${id}`, mappers);
  return id;
}

function clientAttributes(plan: ClientPlan): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (plan.pkce) attributes["pkce.code.challenge.method"] = plan.pkce;
  if (plan.public) attributes["post.logout.redirect.uris"] = "+";
  if (plan.backchannelLogoutUrl) {
    attributes["backchannel.logout.url"] = plan.backchannelLogoutUrl;
    attributes["backchannel.logout.session.required"] = "true";
  }
  return attributes;
}

function clientBody(plan: ClientPlan, serviceSecret: string): Json {
  return {
    clientId: plan.clientId,
    enabled: true,
    protocol: "openid-connect",
    publicClient: plan.public,
    standardFlowEnabled: plan.public,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: Boolean(plan.serviceRole),
    redirectUris: plan.redirectUris,
    webOrigins: plan.public ? ["+"] : [],
    attributes: clientAttributes(plan),
    ...(plan.fixedSecret ? { secret: serviceSecret } : {}),
  };
}

async function upsertClient(ctx: Ctx, plan: ClientPlan): Promise<string> {
  const lookup = `/${ctx.realm}/clients?clientId=${enc(plan.clientId)}`;
  const found = asList(await ctx.admin.get(lookup))[0];
  const body = clientBody(plan, ctx.options.serviceSecret);
  if (found) {
    // El GET puede traer el secreto enmascarado: no se reenvia salvo que sea el fijo del plan.
    const { secret: _masked, ...current } = found;
    const attributes = { ...(found.attributes as Json), ...(body.attributes as Json) };
    await ctx.admin.put(`/${ctx.realm}/clients/${found.id}`, { ...current, ...body, attributes });
    return String(found.id);
  }
  await ctx.admin.post(`/${ctx.realm}/clients`, body);
  ctx.created.push(`client:${plan.clientId}`);
  return String(asList(await ctx.admin.get(lookup))[0]?.id);
}

async function assignRealmRole(ctx: Ctx, userId: string, role: string): Promise<void> {
  const roleRep = await ctx.admin.get(`/${ctx.realm}/roles/${enc(role)}`);
  await ctx.admin.post(`/${ctx.realm}/users/${userId}/role-mappings/realm`, [roleRep]);
}

async function assignServiceRole(ctx: Ctx, clientUuid: string, role: string): Promise<void> {
  const path = `/${ctx.realm}/clients/${clientUuid}/service-account-user`;
  const user = (await ctx.admin.get(path)) as Json;
  await assignRealmRole(ctx, String(user.id), role);
}

async function readSecret(ctx: Ctx, plan: ClientPlan, uuid: string): Promise<string> {
  if (plan.fixedSecret) return ctx.options.serviceSecret;
  const secret = (await ctx.admin.get(`/${ctx.realm}/clients/${uuid}/client-secret`)) as Json;
  return String(secret.value);
}

async function ensureClient(
  ctx: Ctx,
  plan: ClientPlan,
  scopeId: string,
  out: ApplyResult,
): Promise<void> {
  const uuid = await upsertClient(ctx, plan);
  await ctx.admin.put(`/${ctx.realm}/clients/${uuid}/default-client-scopes/${scopeId}`);
  await ensureMappers(ctx, `/${ctx.realm}/clients/${uuid}`, plan.mappers);
  if (plan.serviceRole) await assignServiceRole(ctx, uuid, plan.serviceRole);
  if (!plan.public) out.clientSecrets[plan.clientId] = await readSecret(ctx, plan, uuid);
}

async function createUser(ctx: Ctx, plan: UserPlan): Promise<void> {
  await ctx.admin.post(`/${ctx.realm}/users`, {
    username: plan.username,
    email: `${plan.username}@lab.invalid`,
    firstName: plan.role,
    lastName: plan.username,
    enabled: true,
    emailVerified: true,
    attributes: { tenant_id: [plan.tenantId] },
  });
  ctx.created.push(`user:${plan.username}`);
}

async function ensureUser(ctx: Ctx, plan: UserPlan): Promise<void> {
  const lookup = `/${ctx.realm}/users?username=${enc(plan.username)}&exact=true`;
  let user = asList(await ctx.admin.get(lookup))[0];
  if (user) {
    const attributes = { ...(user.attributes as Json), tenant_id: [plan.tenantId] };
    await ctx.admin.put(`/${ctx.realm}/users/${user.id}`, { ...user, enabled: true, attributes });
  } else {
    await createUser(ctx, plan);
    user = asList(await ctx.admin.get(lookup))[0];
  }
  const id = String(user?.id);
  await ctx.admin.put(`/${ctx.realm}/users/${id}/reset-password`, {
    type: "password",
    value: ctx.options.userPassword,
    temporary: false,
  });
  await assignRealmRole(ctx, id, plan.role);
}

export async function applyPlan(
  admin: AdminClient,
  plan: LabPlan,
  options: ApplyOptions,
): Promise<ApplyResult> {
  const ctx: Ctx = { admin, realm: plan.realm.name, created: [], options };
  const out: ApplyResult = { created: ctx.created, clientSecrets: {} };
  await ensureRealm(ctx, plan);
  await ensureUserProfile(ctx, plan);
  await ensureRoles(ctx, plan);
  const scopeId = await ensureScope(ctx, plan);
  for (const client of plan.clients) await ensureClient(ctx, client, scopeId, out);
  for (const user of plan.users) await ensureUser(ctx, user);
  return out;
}
