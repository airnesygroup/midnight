import { MongoClient } from "mongodb";
import { publicationStatus } from "../src/lib/mongodb/schemas";

// Operator-run: preserve every existing validation rule except the out-of-date status enum.
const uri = process.env["MONGODB_URI"];
if (!uri) throw new Error("MongoDB connection is not configured");
const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db("midnight");
  const [collection] = await db.listCollections({ name: "articles" }).toArray();
  const validator = collection?.options?.validator;
  const status = validator?.["$jsonSchema"]?.properties?.status;
  if (!status || !Array.isArray(status.enum)) throw new Error("Article status validator not found; no changes made");
  status.enum = publicationStatus.options;
  await db.command({ collMod: "articles", validator });
  console.log("Article status validation aligned; all other rules preserved.");
} finally { await client.close(); }