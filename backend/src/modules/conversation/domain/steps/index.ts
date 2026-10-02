import type { StepRegistry } from "../types";
import { appointmentsMenu, cancelConfirm, pickAppointment } from "./appointments";
import { bookConfirm, bookDay, bookPractitioner, bookService, bookSlot } from "./booking";
import { idDocumentNumber, idDocumentType } from "./identification";
import { kbQuery, kbResults } from "./knowledge";
import { closed, mainMenu, verificationBlocked } from "./menu";
import { preregConfirm, preregField, privacyNotice } from "./pre-registration";
import { verifyQuestion } from "./verification";

/** Unico lugar que conoce todos los pasos; ningun paso importa este archivo (0 ciclos). */
export const STEPS: StepRegistry = {
  main_menu: mainMenu,
  closed,
  kb_query: kbQuery,
  kb_results: kbResults,
  id_document_type: idDocumentType,
  id_document_number: idDocumentNumber,
  verify_question: verifyQuestion,
  verification_blocked: verificationBlocked,
  privacy_notice: privacyNotice,
  prereg_field: preregField,
  prereg_confirm: preregConfirm,
  appointments_menu: appointmentsMenu,
  pick_appointment: pickAppointment,
  cancel_confirm: cancelConfirm,
  book_service: bookService,
  book_practitioner: bookPractitioner,
  book_day: bookDay,
  book_slot: bookSlot,
  book_confirm: bookConfirm,
};
