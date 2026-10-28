import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listInbox } from "@/app/api/sim/v1/inbox/route";
import { resetContainer } from "@/composition-root";
import { authedRequest, signToken } from "../helpers/idp";
import {
  type ChatBody,
  enableWidget,
  getChat,
  type HistoryBody,
  openChat,
  optionId,
  sendChat,
  type WidgetChat,
} from "./chat-support";
import { HOUR_MS, seedWorld, type World } from "./pre-agenda-support";
import { testPrisma, truncateAll } from "./support";

const prisma: PrismaClient = testPrisma();

describe("flujo: punta a punta por HTTP", () => {
  let world: World;
  let chat: WidgetChat;
  let body: ChatBody;
  let history: HistoryBody;

  const say = async (message: { option_id: string } | { text: string }) => {
    const response = await sendChat(chat, message);
    expect(response.status).toBe(200);
    body = await response.json();
    return body;
  };
  const choose = (label: string) => say({ option_id: optionId(body, label) });
  const first = () => say({ option_id: body.options[0]?.id ?? "?" });

  beforeEach(async () => {
    await truncateAll(prisma);
    resetContainer();
    const start = new Date(Math.ceil((Date.now() + 2 * HOUR_MS) / HOUR_MS) * HOUR_MS);
    world = await seedWorld(prisma, "chat", start);
    chat = await openChat(await enableWidget(prisma, world.tenantId, "chat"));
    history = await (await getChat(chat)).json();
    body = {
      messages: history.messages.map((m) => m.text),
      options: history.options,
      input: history.input,
    };
  });

  afterAll(async () => {
    resetContainer();
    await prisma.$disconnect();
  });

  async function verifyExistingPatient() {
    // El chat normaliza el documento a mayusculas: el del seed (`1000chat`) no se encontraria.
    await prisma.medicalRecord.update({
      where: { id: world.medicalRecordId },
      data: { phone: "3001234567", documentNumber: "10002030" },
    });
    const now = new Date();
    await prisma.verificationChallenge.create({
      data: {
        id: "vc",
        tenantId: world.tenantId,
        medicalRecordId: world.medicalRecordId,
        questionIds: ["birth_day", "phone_last_4"],
        createdAt: now,
        updatedAt: now,
      },
    });
    await choose("Mis citas");
    await choose("Cédula de ciudadanía");
    await say({ text: "10002030" });
    await say({ text: "15" });
    await say({ text: "4567" });
  }

  it("documento nuevo: pre-registro y solicitud que llega a la bandeja", async () => {
    expect(history.messages[0]?.text).toBe(
      "Hola, soy el asistente virtual de Tenant chat. ¿En qué te puedo ayudar?",
    );
    await choose("Mis citas");
    await choose("Cédula de ciudadanía");
    await say({ text: "99887766" });
    await choose("Acepto");
    for (const value of ["Ana", "Paz", "1990-03-07", "3001234567"]) {
      await say({ text: value });
    }
    await choose("Omitir");
    expect(String(body.messages[0])).toContain("Ana Paz");
    await choose("Confirmar");
    await choose("Agendar una cita");
    await choose("Serv chat");
    await choose("Cualquiera");
    await first();
    await first();
    await choose("Confirmar");
    expect(String(body.messages[0])).toMatch(/^Enviamos tu solicitud/);

    const request = await prisma.appointmentRequest.findFirstOrThrow({
      where: { tenantId: world.tenantId },
    });
    expect(request).toMatchObject({ kind: "book", status: "pending" });
    expect(
      (await prisma.medicalRecord.findUniqueOrThrow({ where: { id: request.medicalRecordId } }))
        .status,
    ).toBe("pre_registered");
    // El sub del token es el del cliente widget de la clinica: la auditoria usa la sesion.
    const session = await prisma.widgetSession.findFirstOrThrow();
    const widgetEvents = await prisma.auditEvent.findMany({ where: { actorRole: "widget" } });
    expect(widgetEvents.length).toBeGreaterThan(0);
    expect(new Set(widgetEvents.map((e) => e.actorSubject))).toEqual(
      new Set([`widget:${session.id}`]),
    );
    const admin = await signToken({ role: "admin", tenantId: world.tenantId });
    const inbox = await (
      await listInbox(authedRequest("http://localhost/api/sim/v1/inbox", admin))
    ).json();
    expect(inbox.data.map((r: { id: string }) => r.id)).toContain(request.id);

    const after = await (await getChat(chat)).json();
    expect(JSON.stringify(after)).not.toContain("3001234567");
    expect(JSON.stringify(after)).not.toContain("Ana Paz");
  });

  it("paciente existente: verificacion y cancelacion sin dejar respuestas en ningun lado", async () => {
    await verifyExistingPatient();
    expect(body.messages).toContain("Verificamos tu identidad.");
    await choose("Cancelar una cita");
    await first();
    await choose("Confirmar");
    expect(body.messages[0]).toBe(
      "Enviamos tu solicitud de cancelación. Tenant chat la confirmará.",
    );
    expect(
      await prisma.appointmentRequest.findFirstOrThrow({ where: { tenantId: world.tenantId } }),
    ).toMatchObject({ kind: "cancel" });

    const texts = (await prisma.conversationMessage.findMany()).map((m) => m.text);
    expect(texts).not.toContain("15");
    expect(texts).not.toContain("4567");
    const context = JSON.stringify((await prisma.conversation.findMany()).map((c) => c.context));
    expect(context).not.toContain('"4567"');
    const responses = JSON.stringify(
      (await prisma.idempotencyKey.findMany()).map((k) => k.responseBody),
    );
    expect(responses).not.toContain('"4567"');
    const audits = await prisma.auditEvent.findMany({ where: { tenantId: world.tenantId } });
    expect(audits.map((a) => a.action)).toContain("verification.succeeded");
  });

  it("el hash de la peticion lleva clave: no se recupera la respuesta corta", async () => {
    await choose("Mis citas");
    await choose("Cédula de ciudadanía");
    await say({ text: "1000chat" });
    const key = randomUUID();
    const bodyText = JSON.stringify({ text: "15" });
    await sendChat(chat, { text: "15" }, key);
    const row = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
    const plain = createHash("sha256")
      .update(`POST\n/api/v1/widget/conversation/messages\n${bodyText}`)
      .digest("hex");
    expect(row.requestHash).not.toBe(plain);
  });

  it("un cupo tomado entre la eleccion y la confirmacion no rompe la conversacion", async () => {
    await verifyExistingPatient();
    await choose("Agendar una cita");
    await choose("Serv chat");
    await choose("Cualquiera");
    await first();
    await first();
    await prisma.slot.update({ where: { id: world.freeSlotIds[0] }, data: { status: "busy" } });
    await choose("Confirmar");
    expect(body.messages[0]).toBe("Ese horario se acaba de ocupar. Elige otro.");
    expect(await prisma.appointmentRequest.count()).toBe(0);
    expect(body.options.length).toBeGreaterThan(0);
  });

  it("un documento registrado a mitad del pre-registro sigue con la verificacion (SAVEPOINT)", async () => {
    await choose("Mis citas");
    await choose("Cédula de ciudadanía");
    await say({ text: "55443322" });
    await choose("Acepto");
    for (const value of ["Ana", "Paz", "1990-03-07", "3001234567"]) {
      await say({ text: value });
    }
    await choose("Omitir");
    await prisma.medicalRecord.create({
      data: {
        id: "mr-race",
        tenantId: world.tenantId,
        identifierSystem: "urn:hermes:patient",
        identifierValue: "MR-race",
        documentType: "CC",
        documentNumber: "55443322",
        givenNames: "Otra",
        familyNames: "Persona",
        birthDate: new Date("1980-01-01"),
      },
    });
    await choose("Confirmar");
    expect(body.messages[0]).toBe(
      "Ese documento ya está registrado. Vamos a verificar tu identidad.",
    );
    const actions = (await prisma.auditEvent.findMany()).map((a) => a.action);
    expect(actions).not.toContain("patient.pre_registered");
  });

  it("opcion de un turno anterior: 409 stale_option", async () => {
    const old = optionId(body, "Mis citas");
    await choose("Consultas generales");
    const response = await sendChat(chat, { option_id: old });
    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toEqual({ reason: "stale_option" });
  });

  it("idempotencia: misma clave repite; la misma clave desde otra sesion es 409", async () => {
    const key = randomUUID();
    const message = { option_id: optionId(body, "Mis citas") };
    const firstResponse = await (await sendChat(chat, message, key)).json();
    const count = await prisma.conversationMessage.count();
    expect(await (await sendChat(chat, message, key)).json()).toEqual(firstResponse);
    expect(await prisma.conversationMessage.count()).toBe(count);

    const other = await openChat(`wk_${"chat".repeat(43).slice(0, 43)}`);
    await getChat(other);
    expect((await sendChat(other, message, key)).status).toBe(409);
  });

  it("roles, sesion vencida y origen ajeno", async () => {
    const operator = await signToken({ role: "operator", tenantId: world.tenantId });
    expect((await getChat({ ...chat, token: operator })).status).toBe(403);
    expect((await getChat(chat, { Origin: "https://otra.test" })).status).toBe(403);
    // La tabla exige expires_at > created_at: se retrasan ambos.
    await prisma.widgetSession.updateMany({
      data: { createdAt: new Date(Date.now() - HOUR_MS), expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await getChat(chat)).status).toBe(404);
  });
});
