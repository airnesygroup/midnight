#!/usr/bin/env node
// Copies the whole "midnight" database from the CURRENT MongoDB (MONGODB_URI)
// to the NEW MongoDB (NEW_MONGODB_URI).
//
//   node scripts/migrate-mongodb.mjs --dry-run        look only, change nothing
//   node scripts/migrate-mongodb.mjs                  copy (safe to re-run)
//   node scripts/migrate-mongodb.mjs --wipe-target    empty the new collections first, then copy
//   node scripts/migrate-mongodb.mjs --db=midnight    database name (default: MONGODB_DB or "midnight")
//
// The current database is only ever READ. Nothing in it is changed or deleted.
// Order per collection: create -> copy documents -> rebuild indexes -> re-apply validator.
// Re-running skips documents that already exist in the new database (same _id).

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const BATCH = 500;
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const WIPE = argv.includes("--wipe-target");

// ---- .env loader (handles quotes and Windows CRLF; real env vars win) ----
function loadEnv() {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const redact = (uri) => uri.replace(/\/\/([^:@/]+):([^@]+)@/, "//$1:***@");
const hostOf = (uri) => (uri.match(/@([^/?]+)/)?.[1] ?? uri).toLowerCase();
const fail = (msg) => {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
};

async function insertBatch(col, docs) {
  if (!docs.length) return { inserted: 0, skipped: 0 };
  try {
    const r = await col.insertMany(docs, { ordered: false });
    return { inserted: r.insertedCount, skipped: 0 };
  } catch (e) {
    const errs = Array.isArray(e.writeErrors) ? e.writeErrors : e.writeErrors ? [e.writeErrors] : [];
    const onlyDuplicates = errs.length > 0 && errs.every((x) => (x.code ?? x.err?.code) === 11000);
    if (!onlyDuplicates) throw e;
    const inserted = e.insertedCount ?? e.result?.insertedCount ?? 0;
    return { inserted, skipped: docs.length - inserted };
  }
}

async function main() {
  loadEnv();
  const SRC = process.env.MONGODB_URI;
  const DST = process.env.NEW_MONGODB_URI;
  const dbArg = argv.find((a) => a.startsWith("--db="))?.slice(5);
  const DB = dbArg || process.env.MONGODB_DB || "midnight";

  if (!SRC) fail("MONGODB_URI (the CURRENT database) is missing from .env");
  if (!DST) fail("NEW_MONGODB_URI (the NEW database) is missing from .env");
  if (SRC === DST || hostOf(SRC) === hostOf(DST)) {
    fail("MONGODB_URI and NEW_MONGODB_URI point to the same cluster. Refusing to copy a database onto itself.");
  }

  console.log(`From : ${redact(SRC)}`);
  console.log(`To   : ${redact(DST)}`);
  console.log(`DB   : ${DB}${DRY ? "   [DRY RUN - nothing will be written]" : ""}${WIPE ? "   [WIPE TARGET]" : ""}\n`);

  const opts = { serverSelectionTimeoutMS: 15000 };
  const src = new MongoClient(SRC, opts);
  const dst = new MongoClient(DST, opts);

  try {
    try {
      await src.connect();
      await src.db("admin").command({ ping: 1 });
    } catch (e) {
      fail(`Cannot connect to the CURRENT database: ${e.message}`);
    }
    try {
      await dst.connect();
      await dst.db("admin").command({ ping: 1 });
    } catch (e) {
      fail(
        `Cannot connect to the NEW database: ${e.message}\n` +
          "Check: (1) the password is URL-encoded (@ becomes %40, # becomes %23), and " +
          "(2) Atlas > Network Access allows your IP address.",
      );
    }

    const srcDb = src.db(DB);
    const dstDb = dst.db(DB);

    const all = await srcDb.listCollections().toArray();
    const colls = all.filter((c) => !c.name.startsWith("system."));
    for (const v of colls.filter((c) => c.type === "view")) {
      console.log(`  ! skipping view "${v.name}" (views hold no data; recreate it by hand if you use it)`);
    }
    const real = colls.filter((c) => c.type !== "view");
    if (!real.length) fail(`No collections found in database "${DB}" on the current cluster. Is the database name right?`);

    const stats = await srcDb.command({ dbStats: 1 }).catch(() => null);
    if (stats) {
      console.log(`Source size: ${(stats.dataSize / 1048576).toFixed(1)} MB data, ${(stats.storageSize / 1048576).toFixed(1)} MB on disk (free Atlas M0 limit is 512 MB)\n`);
    }

    const report = [];

    for (const info of real) {
      const name = info.name;
      const sCol = srcDb.collection(name);
      const total = await sCol.countDocuments();
      const idx = (await sCol.listIndexes().toArray()).filter((i) => i.name !== "_id_");

      if (DRY) {
        console.log(`  ${name.padEnd(28)} ${String(total).padStart(8)} docs, ${idx.length} extra indexes${info.options?.validator ? ", has validator" : ""}`);
        continue;
      }

      const dCol = dstDb.collection(name);
      if (WIPE) await dCol.drop().catch((e) => { if (e.code !== 26) throw e; });

      const exists = (await dstDb.listCollections({ name }).toArray()).length > 0;
      if (!exists) {
        // validator is applied last so documents that pre-date it cannot be rejected on insert
        const { validator, validationLevel, validationAction, ...createOpts } = info.options ?? {};
        await dstDb.createCollection(name, createOpts);
      }

      let inserted = 0;
      let skipped = 0;
      let buf = [];
      const cursor = sCol.find({}, { batchSize: BATCH });
      for await (const doc of cursor) {
        buf.push(doc);
        if (buf.length >= BATCH) {
          const r = await insertBatch(dCol, buf);
          inserted += r.inserted;
          skipped += r.skipped;
          buf = [];
          process.stdout.write(`\r  ${name}: ${inserted + skipped}/${total}   `);
        }
      }
      const last = await insertBatch(dCol, buf);
      inserted += last.inserted;
      skipped += last.skipped;

      let idxOk = 0;
      const idxErrors = [];
      for (const i of idx) {
        const { v, ns, key, ...rest } = i;
        try {
          await dCol.createIndexes([{ key, ...rest }]);
          idxOk++;
        } catch (e) {
          idxErrors.push(`${i.name}: ${e.message}`);
        }
      }

      let validatorNote = "";
      if (info.options?.validator) {
        try {
          await dstDb.command({
            collMod: name,
            validator: info.options.validator,
            validationLevel: info.options.validationLevel ?? "strict",
            validationAction: info.options.validationAction ?? "error",
          });
          validatorNote = ", validator applied";
        } catch (e) {
          idxErrors.push(`validator: ${e.message}`);
        }
      }

      process.stdout.write("\r");
      console.log(
        `  ${name.padEnd(28)} copied ${inserted}` +
          (skipped ? `, already there ${skipped}` : "") +
          `, indexes ${idxOk}/${idx.length}${validatorNote}`,
      );
      for (const m of idxErrors) console.log(`      ! ${m}`);
      report.push({ name, total, idxExpected: idx.length });
    }

    if (DRY) {
      console.log("\nDry run finished. Nothing was written.");
      return;
    }

    // ---- verification: counts and index counts must match ----
    console.log("\nVerifying...");
    let bad = 0;
    for (const r of report) {
      const n = await dstDb.collection(r.name).countDocuments();
      const ix = (await dstDb.collection(r.name).listIndexes().toArray()).filter((i) => i.name !== "_id_").length;
      const ok = n === r.total && ix === r.idxExpected;
      if (!ok) bad++;
      console.log(`  ${ok ? "OK  " : "FAIL"} ${r.name.padEnd(28)} old ${r.total} / new ${n}   indexes old ${r.idxExpected} / new ${ix}`);
    }
    if (bad) {
      console.log(`\n${bad} collection(s) do not match. Do NOT switch over yet. Re-run (it is safe), or use --wipe-target for a clean copy.`);
      process.exitCode = 2;
    } else {
      console.log("\nAll collections match. The new database is a complete copy.");
    }
  } finally {
    await src.close().catch(() => {});
    await dst.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("\nUnexpected error:", e);
  process.exit(1);
});
