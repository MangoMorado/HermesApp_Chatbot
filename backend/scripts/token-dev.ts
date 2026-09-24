/**
 * Firma un JWT de desarrollo para pegar en el panel.
 * Uso: npm run token:dev -- --tenant <id> --role <rol> [--subject <sub>] [--session <id>]
 */
import { SignJWT } from "jose";
import { loadConfig } from "../src/config/env";
import type { Role } from "../src/modules/auth/domain/role";

const ROLES: readonly Role[] = ["widget", "operator", "admin", "service"];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const tenant = arg("tenant");
  const roleRaw = arg("role");
  if (!tenant || !roleRaw) {
    process.stderr.write("Uso: npm run token:dev -- --tenant <id> --role <rol>\n");
    process.exit(1);
  }
  if (!ROLES.includes(roleRaw as Role)) {
    process.stderr.write(`Rol invalido. Usa: ${ROLES.join(", ")}\n`);
    process.exit(1);
  }

  const config = loadConfig();
  if (config.nodeEnv === "production") {
    process.stderr.write(
      "token:dev no se usa en produccion: emite tokens con POST /api/platform/v1/tokens\n",
    );
    process.exit(1);
  }
  const claims: Record<string, string> = {
    tenant_id: tenant,
    role: roleRaw,
  };
  const session = arg("session");
  if (session) {
    claims.session_id = session;
  }

  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(arg("subject") ?? "dev-user")
    .setIssuer(config.jwt.issuer)
    .setAudience(config.jwt.audience)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(new TextEncoder().encode(config.jwt.secret));

  process.stdout.write(`${token}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
