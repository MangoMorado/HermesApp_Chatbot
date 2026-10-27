/** La clinica no tiene credenciales de cliente maquina del tipo pedido. */
export class MachineCredentialMissingError extends Error {
  constructor(readonly kind: "widget" | "service") {
    super(`Faltan credenciales de cliente maquina (${kind})`);
    this.name = "MachineCredentialMissingError";
  }
}

/** El proveedor de identidad no responde o rechaza las credenciales de un cliente maquina. */
export class IdentityUnavailableError extends Error {
  constructor(message = "Proveedor de identidad no disponible") {
    super(message);
    this.name = "IdentityUnavailableError";
  }
}
