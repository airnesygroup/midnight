import { MongoClient, type Db } from "mongodb";

// Server-only: MongoDB access and field encryption for community data.
const DB_NAME = "midnight";

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const uri = process.env["MONGODB_URI"];
  if (!uri) throw new Error("Community storage is not configured");
  // One client per request: the edge runtime cannot share sockets across requests.
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 1 });
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    await ensureIndexes(db);
    return await fn(db);
  } finally {
    await client.close().catch(() => {});
  }
}

let indexesReady = false;
async function ensureIndexes(db: Db) {
  if (indexesReady) return;
  await Promise.all([
    db.collection("communityProfiles").createIndex({ usernameLower: 1 }, { unique: true, name: "username_unique" }),
    db.collection("communityComments").createIndex({ articleSlug: 1, createdAt: 1 }, { name: "discussion" }),
    db.collection("communityComments").createIndex({ userId: 1, createdAt: -1 }, { name: "by_user" }),
    db.collection("communityComments").createIndex({ parentId: 1 }, { name: "replies" }),
    db.collection("communityInteractions").createIndex({ userId: 1, articleSlug: 1, kind: 1 }, { unique: true, name: "one_interaction" }),
    db.collection("communityInteractions").createIndex({ articleSlug: 1, kind: 1 }, { name: "article_counts" }),
    db.collection("communityCommentLikes").createIndex({ userId: 1, commentId: 1 }, { unique: true, name: "one_like" }),
    db.collection("communityCommentLikes").createIndex({ commentId: 1 }, { name: "comment_likes" }),
    db.collection("communityShares").createIndex({ articleSlug: 1 }, { name: "article_shares" }),
  ]);
  indexesReady = true;
}

let keyPromise: Promise<CryptoKey> | null = null;
let keySecret: string | null = null;
function key() {
  const secret = process.env["COMMUNITY_ENCRYPTION_KEY"];
  if (!secret) throw new Error("Encryption key is not configured");
  if (keySecret !== secret) { keySecret = secret; keyPromise = null; }
  keyPromise ??= crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(secret))
    .then((raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
  return keyPromise;
}

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** AES-256-GCM; stored as "v1:<base64(iv|ciphertext)>". */
export async function encrypt(text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(text)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return `v1:${toB64(out)}`;
}

export async function decrypt(value: string | null | undefined): Promise<string> {
  if (!value) return "";
  if (!value.startsWith("v1:")) return "";
  const raw = fromB64(value.slice(3));
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await key(), raw.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    // Locked with a different key: show nothing rather than failing the whole page.
    console.error("community: could not unlock a stored field (encryption key mismatch?)");
    return "";
  }
}
