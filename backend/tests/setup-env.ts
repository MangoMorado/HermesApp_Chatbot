import { installFakeIdp, TEST_OIDC } from "./helpers/idp";

// Entorno de las suites. Los valores son de prueba: nunca tocan un servicio real.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test?schema=public",
  HERMES_SIMULATOR_ENABLED: "false",
  OIDC_ISSUER: TEST_OIDC.issuer,
  OIDC_AUDIENCE: TEST_OIDC.audience,
  OIDC_LOGOUT_AUDIENCES: TEST_OIDC.logoutAudience,
  CREDENTIALS_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
  HERMES_SIM_SERVICE_CLIENTS: JSON.stringify({
    "*": { client_id: "service-{tenant}", client_secret: "test-client-secret" },
  }),
});

installFakeIdp();
