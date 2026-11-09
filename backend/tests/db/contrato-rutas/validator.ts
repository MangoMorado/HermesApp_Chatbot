import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { contractDocument, declaredOperations, type OpenApiResponse } from "./documents";
import type { ContractCase, Surface } from "./types";

type Checked = Pick<ContractCase, "method" | "path" | "status">;

export type ContractValidator = {
  check(c: Checked, response: Response): Promise<void>;
};

function fail(c: Checked, message: string): never {
  throw new Error(`${c.method.toUpperCase()} ${c.path} → ${c.status}: ${message}`);
}

function mediaType(response: Response): string {
  return (response.headers.get("Content-Type") ?? "").split(";")[0]?.trim() ?? "";
}

async function readBody(response: Response, type: string): Promise<unknown> {
  const text = await response.text();
  if (type.endsWith("json")) {
    return text === "" ? undefined : JSON.parse(text);
  }
  return text;
}

/**
 * Valida una respuesta real contra el documento construido por el builder de la superficie:
 * status declarado, Content-Type, cuerpo segun el esquema de ese status y `X-Request-Id`.
 * Los `$ref` locales se resuelven embebiendo los `components` del documento en cada esquema.
 */
export function createContractValidator(surface: Surface): ContractValidator {
  const document = contractDocument(surface);
  const operations = new Map(declaredOperations(surface).map((op) => [op.key, op]));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const compiled = new Map<string, ValidateFunction>();

  function validatorFor(cacheKey: string, schema: unknown): ValidateFunction {
    const cached = compiled.get(cacheKey);
    if (cached) {
      return cached;
    }
    const root = { ...(schema as object), components: document.components };
    const validate = ajv.compile(root);
    compiled.set(cacheKey, validate);
    return validate;
  }

  function declaredResponse(c: Checked): OpenApiResponse {
    const operation = operations.get(`${surface} ${c.method.toUpperCase()} ${c.path}`);
    if (!operation) {
      fail(c, "operacion no declarada");
    }
    const declared = operation.responses[String(c.status)];
    if (!declared) {
      fail(c, `status no declarado (declarados: ${Object.keys(operation.responses).join(", ")})`);
    }
    return declared;
  }

  async function checkBody(c: Checked, response: Response, declared: OpenApiResponse) {
    const content = declared.content ?? {};
    const declaredTypes = Object.keys(content);
    const type = mediaType(response);
    if (declaredTypes.length === 0) {
      return;
    }
    if (!declaredTypes.includes(type)) {
      fail(c, `Content-Type «${type}» no declarado (${declaredTypes.join(", ")})`);
    }
    const schema = content[type]?.schema;
    if (schema === undefined) {
      return;
    }
    const body = await readBody(response, type);
    const validate = validatorFor(`${c.method} ${c.path} ${c.status} ${type}`, schema);
    if (!validate(body)) {
      fail(
        c,
        `cuerpo fuera de esquema: ${ajv.errorsText(validate.errors)} — ${JSON.stringify(body)}`,
      );
    }
  }

  return {
    async check(c, response) {
      if (response.status !== c.status) {
        const text = await response.text();
        fail(c, `status real ${response.status}, esperado ${c.status}: ${text.slice(0, 300)}`);
      }
      const declared = declaredResponse(c);
      if (!response.headers.get("X-Request-Id")) {
        fail(c, "falta X-Request-Id");
      }
      await checkBody(c, response, declared);
    },
  };
}
