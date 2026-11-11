import { z } from "zod";
import type { Document } from "mongodb";
import { withDb } from "./community.server";

/** MongoDB "reports" collection: one published Midnight Report edition per UTC date. */
export const reportSectionSchema = z.object({
  tag: z.string().min(1).max(60),
  title: z.string().min(1).max(300),
  paragraphs: z.array(z.string().min(1).max(5000)).min(1).max(20),
});
export const reportSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["draft", "published"]),
  title: z.string().min(1).max(200),
  introduction: z.string().max(500),
  leadTitle: z.string().min(1).max(300),
  leadExcerpt: z.string().max(1000),
  leadParagraphs: z.array(z.string().max(5000)).max(20),
  sections: z.array(reportSectionSchema).max(30),
  lastWord: z.string().max(2000),
});
export type Report = z.infer<typeof reportSchema>;

/** MongoDB-side validator so direct inserts keep the same shape. */
export const reportValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["date", "status", "title", "leadTitle", "sections"],
    properties: {
      date: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      status: { enum: ["draft", "published"] },
      title: { bsonType: "string" },
      introduction: { bsonType: "string" },
      leadTitle: { bsonType: "string" },
      leadExcerpt: { bsonType: "string" },
      leadParagraphs: { bsonType: "array", items: { bsonType: "string" } },
      sections: {
        bsonType: "array",
        items: { bsonType: "object", required: ["tag", "title", "paragraphs"], properties: { tag: { bsonType: "string" }, title: { bsonType: "string" }, paragraphs: { bsonType: "array", items: { bsonType: "string" } } } },
      },
      lastWord: { bsonType: "string" },
    },
  },
};

let prepared = false;
async function prepare(db: import("mongodb").Db) {
  if (prepared) return;
  const exists = await db.listCollections({ name: "reports" }, { nameOnly: true }).hasNext();
  if (!exists) await db.createCollection("reports", { validator: reportValidator, validationLevel: "moderate" });
  await db.collection("reports").createIndex({ date: 1 }, { unique: true, name: "one_edition_per_date" });
  prepared = true;
}

const PUBLISHED = { status: "published" };

export async function listReportDates(): Promise<string[]> {
  return withDb(async (db) => {
    await prepare(db);
    const docs = await db.collection("reports").find(PUBLISHED, { projection: { date: 1 } }).sort({ date: -1 }).limit(5000).toArray();
    return docs.map((d) => String(d["date"]));
  });
}

export async function loadReport(date: string): Promise<Report | null> {
  return withDb(async (db) => {
    await prepare(db);
    const d: Document | null = await db.collection("reports").findOne({ ...PUBLISHED, date }, { projection: { _id: 0 } });
    if (!d) return null;
    const r = reportSchema.safeParse({ introduction: "", leadExcerpt: "", leadParagraphs: [], lastWord: "", ...d });
    return r.success ? r.data : null;
  });
}
