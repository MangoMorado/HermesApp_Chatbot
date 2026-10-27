import { describe, expect, it } from "vitest";
import {
  appointmentJson,
  historyAppointmentJson,
  medicalRecordJson,
  pageJson,
  scheduleJson,
  simPatientJson,
  simScheduleJson,
  slotJson,
  tenantSettingsJson,
} from "@/http/serializers";
import { botConfigJson, knowledgeEntryJson, tenantJson } from "@/http/serializers-chatbot";
import {
  conversationHistoryJson,
  conversationTurnJson,
  replayTurn,
  storedTurnJson,
} from "@/http/serializers-conversation";
import { inboxRequestJson } from "@/http/serializers-sim-inbox";
import { EMPTY_OVERRIDES, effectiveConfig } from "@/modules/bot-config/domain/bot-config";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const ID = { system: "urn:hermes:x", value: "1" };
const WHEN = {
  startAt: new Date("2026-06-15T14:00:00.000Z"),
  endAt: new Date("2026-06-15T14:30:00.000Z"),
};

describe("http: serializers REST", () => {
  it("serializa agenda, historia y settings", () => {
    expect(
      scheduleJson({
        id: "sch-1",
        tenantId: "t1",
        identifier: ID,
        practitionerId: "p1",
        healthcareServiceId: "hs1",
        active: true,
      }),
    ).toMatchObject({ practitioner_id: "p1", healthcare_service_id: "hs1" });
    expect(
      slotJson({
        id: "sl-1",
        tenantId: "t1",
        identifier: ID,
        scheduleId: "sch-1",
        status: "free",
        ...WHEN,
      }),
    ).toMatchObject({ schedule_id: "sch-1", status: "free" });
    expect(
      appointmentJson({
        id: "ap-1",
        tenantId: "t1",
        identifier: ID,
        medicalRecordId: "mr-1",
        scheduleId: "sch-1",
        slotId: "sl-1",
        status: "booked",
        ...WHEN,
      }),
    ).toMatchObject({ medical_record_id: "mr-1", status: "booked" });
    expect(
      medicalRecordJson({
        id: "mr-1",
        tenantId: "t1",
        identifier: ID,
        documentType: "CC",
        documentNumber: "1",
        givenNames: "Ana",
        familyNames: "Perez",
        birthDate: "1990-01-01",
        phone: null,
        email: null,
        status: "active",
      }),
    ).toMatchObject({ document_type: "CC", given_names: "Ana" });
    expect(
      historyAppointmentJson({
        id: "ap-1",
        tenantId: "t1",
        scheduleId: "sch-1",
        slotId: "sl-1",
        status: "booked",
        ...WHEN,
      }),
    ).toMatchObject({ schedule_id: "sch-1" });
    expect(tenantSettingsJson({ maxQueryRangeDays: 30 })).toEqual({ max_query_range_days: 30 });
    expect(pageJson({ data: [1, 2], nextCursor: "c" }, (n) => n * 2)).toEqual({
      data: [2, 4],
      next_cursor: "c",
    });
  });

  it("serializa simulador, chatbot y conversacion", () => {
    expect(
      simScheduleJson({
        id: "s1",
        tenantId: "t1",
        identifierSystem: ID.system,
        identifierValue: ID.value,
        practitionerId: "p",
        healthcareServiceId: "h",
        active: true,
      }),
    ).toMatchObject({ practitioner_id: "p" });
    expect(
      simPatientJson({
        id: "p1",
        tenantId: "t1",
        identifierSystem: ID.system,
        identifierValue: ID.value,
        documentType: "CC",
        documentNumber: "1",
        givenNames: "A",
        familyNames: "B",
        birthDate: "1990-01-01",
        phone: null,
        email: null,
        status: "active",
      }),
    ).toMatchObject({ document_number: "1" });
    expect(
      tenantJson({ id: "t1", slug: "norte", name: "Norte", createdAt: WHEN.startAt }),
    ).toMatchObject({ slug: "norte", created_at: WHEN.startAt.toISOString() });
    expect(
      knowledgeEntryJson({
        id: "k1",
        tenantId: toTenantId("t1"),
        category: "Citas",
        question: "Q",
        answer: "A",
        detail: null,
        keywords: ["cita"],
        position: 0,
        active: true,
      }),
    ).toMatchObject({ category: "Citas", keywords: ["cita"] });
    expect(
      botConfigJson({
        config: effectiveConfig(EMPTY_OVERRIDES),
        currentKey: null,
        graceKey: null,
      }),
    ).toMatchObject({
      allowed_origins: [],
      widget_keys: { current: null, grace: null },
    });

    const turn = {
      messages: [
        { text: "hola", redacted: false },
        { text: "secreto", redacted: true },
      ],
      options: [],
      input: null,
    };
    expect(conversationTurnJson(turn)).toEqual({
      messages: ["hola", "secreto"],
      options: [],
      input: null,
    });
    expect(storedTurnJson(turn, "sess-1").body.messages).toContain("[redactado]");
    expect(
      replayTurn({ status: 200, body: { session_id: "sess-1", body: { ok: true } } }, "sess-1"),
    ).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(() =>
      replayTurn({ status: 200, body: { session_id: "otra", body: {} } }, "sess-1"),
    ).toThrow(ConflictError);
    expect(
      conversationHistoryJson({
        messages: [
          {
            author: "bot",
            text: "hola",
            redacted: false,
            createdAt: WHEN.startAt,
          },
        ],
        options: [],
        input: null,
      }),
    ).toMatchObject({
      messages: [{ author: "bot", created_at: WHEN.startAt.toISOString() }],
    });
    expect(
      inboxRequestJson({
        id: "i1",
        kind: "book",
        status: "pending",
        createdAt: WHEN.startAt,
        expiresAt: WHEN.endAt,
        resolutionReason: null,
        patient: {
          identifier: ID,
          documentType: "CC",
          documentNumber: "1",
          givenNames: "A",
          familyNames: "B",
        },
        slot: { identifier: ID, ...WHEN },
        appointment: null,
        resultingAppointment: null,
      }),
    ).toMatchObject({ kind: "book", patient: { document_type: "CC" } });
  });
});
