// Entorno de las suites. Los valores son de prueba: nunca tocan un servicio real.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test?schema=public",
  JWT_SECRET: "secreto-de-pruebas-suficientemente-largo-para-hs256",
  JWT_ISSUER: "chatbot-ingenius-360",
  JWT_AUDIENCE: "chatbot-ingenius-360",
  HERMES_SIMULATOR_ENABLED: "false",
});
