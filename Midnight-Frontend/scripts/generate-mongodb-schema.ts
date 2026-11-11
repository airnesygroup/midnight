import { mkdir, writeFile } from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import { collectionSchemas } from "../src/lib/mongodb/schemas";
import { collectionIndexes } from "../src/lib/mongodb/indexes";

function mongoSchema(value: unknown, field = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => mongoSchema(item, field));
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  if (field === "_id") return { bsonType: ["objectId", "string"] };
  if (["expiresAt", "idleExpiresAt", "lastSeenAt", "revokedAt", "windowStartedAt"].includes(field)) {
    return { bsonType: input['type'] === 'string' ? "date" : ["date", "null"] };
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (["$schema", "format", "default", "definitions"].includes(key)) continue;
    if (key === "type" && child === "integer") { out['bsonType'] = ["int", "long", "double"]; out['multipleOf'] = 1; }
    else if (key === "properties") out[key] = Object.fromEntries(Object.entries(child as Record<string, unknown>).map(([name, rule]) => [name, mongoSchema(rule, name)]));
    else out[key] = mongoSchema(child, field);
  }
  return out;
}
const collections = Object.fromEntries(Object.entries(collectionSchemas).map(([name, schema]) => [name, {
  validator: { $jsonSchema: mongoSchema(zodToJsonSchema(schema, { $refStrategy: "none" })) },
  validationLevel: "strict", validationAction: "error", indexes: collectionIndexes[name] ?? [],
}]));
await mkdir("mongodb", { recursive: true });
await writeFile("mongodb/schema.json", JSON.stringify({ schemaVersion: 1, collections }, null, 2) + "\n");
console.log(`Generated validators and indexes for ${Object.keys(collections).length} collections.`);
