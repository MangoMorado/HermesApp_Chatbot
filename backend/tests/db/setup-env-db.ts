/**
 * Setup del proyecto Vitest `db`: redirige DATABASE_URL a la base de pruebas
 * y enciende el simulador para las rutas /api/sim/v1.
 * Debe correr después de tests/setup-env.ts.
 */
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5432/chatbot_test";

Object.assign(process.env, {
  DATABASE_URL: testDatabaseUrl,
  HERMES_SIMULATOR_ENABLED: "true",
  FHIR_GATEWAY: "handlers",
});
