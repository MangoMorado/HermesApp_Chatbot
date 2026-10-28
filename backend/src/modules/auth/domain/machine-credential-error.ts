/** La clinica no tiene credenciales de cliente maquina del tipo pedido. */
export class MachineCredentialMissingError extends Error {
  constructor(readonly kind: "widget" | "service") {
    super(`Faltan credenciales de cliente maquina (${kind})`);
    this.name = "MachineCredentialMissingError";
  }
}

/**
 * Las credenciales existen, pero el proveedor emite con ellas un token que no es del rol o de
 * la clinica esperados (p. ej. se registro un cliente `service` como widget). Para el contrato
 * es lo mismo que no tenerlas: el cliente maquina no esta configurado.
 */
export class MachineCredentialMismatchError extends MachineCredentialMissingError {
  constructor(kind: "widget" | "service") {
    super(kind);
    this.message = `Las credenciales de cliente maquina (${kind}) no emiten el rol o la clinica esperados`;
    this.name = "MachineCredentialMismatchError";
  }
}

/** El proveedor de identidad no responde o rechaza las credenciales de un cliente maquina. */
export class IdentityUnavailableError extends Error {
  constructor(message = "Proveedor de identidad no disponible") {
    super(message);
    this.name = "IdentityUnavailableError";
  }
}
