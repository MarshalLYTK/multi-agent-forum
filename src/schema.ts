import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import { ForumError } from "./error.js";

const schemaNames = [
  "forum",
  "agent",
  "topic",
  "status",
  "response",
  "receipt",
  "resolution",
  "action",
  "invitation",
  "join-request",
] as const;

export type SchemaName = (typeof schemaNames)[number];

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
addFormats(ajv);
const validators = new Map<SchemaName, ValidateFunction>();

for (const name of schemaNames) {
  const path = fileURLToPath(new URL(`../schemas/${name}.schema.json`, import.meta.url));
  const schema = JSON.parse(readFileSync(path, "utf8")) as object;
  validators.set(name, ajv.compile(schema));
}

function renderErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

export function assertSchema(name: SchemaName, value: unknown, label: string = name): void {
  const validator = validators.get(name);
  if (!validator) throw new ForumError("AF_SCHEMA_MISSING", `schema not loaded: ${name}`, 1);
  if (!validator(value)) {
    throw new ForumError("AF_SCHEMA", `${label}: ${renderErrors(validator.errors)}`, 2, {
      schema: name,
      errors: validator.errors,
    });
  }
}
