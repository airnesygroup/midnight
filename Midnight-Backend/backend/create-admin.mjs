#!/usr/bin/env node
// Creates (or resets) the first admin account in the "adminAccounts" collection.
// Matches the format used by Midnight-Frontend/src/lib/admin.server.ts
// (PBKDF2-SHA256, 100000 iterations, "pbkdf2$iter$saltHex$hashHex").
//
// Run from the folder that contains .env:
//   node --env-file=.env create-admin.mjs
//
// Optional:
//   --username=admin --email=admin --password=admin --db=midnight
//
// Uses NEW_MONGODB_URI if present, otherwise MONGODB_URI.
// If the username already exists, its password is reset and it is re-enabled.

import { MongoClient } from "mongodb";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const USERNAME = arg("username", "admin");
const EMAIL = arg("email", "admin").toLowerCase();
const PASSWORD = arg("password", "admin");
const DB = arg("db", process.env.MONGODB_DB || "midnight");
const URI = process.env.NEW_MONGODB_URI || process.env.MONGODB_URI;
const ITER = 100_000;

const mask = (u) => u.replace(/\/\/([^:@/]+):([^@]+)@/, "//$1:***@");

if (!URI) {
  console.error("ERROR: NEW_MONGODB_URI or MONGODB_URI is missing from .env");
  process.exit(1);
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITER, 32, "sha256");
  return `pbkdf2$${ITER}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

console.log(`Database : ${mask(URI)}  (db "${DB}")`);
console.log(`Account  : username "${USERNAME}", email "${EMAIL}", role admin\n`);

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 15000 });

try {
  await client.connect();
  const col = client.db(DB).collection("adminAccounts");

  // Same indexes the app creates, so nothing conflicts when the site starts.
  await col.createIndex({ usernameLower: 1 }, { unique: true, name: "username_unique" }).catch(() => {});
  await col.createIndex({ email: 1 }, { unique: true, name: "email_unique" }).catch(() => {});

  const usernameLower = USERNAME.toLowerCase();
  const passwordHash = hashPassword(PASSWORD);
  const existing = await col.findOne({ usernameLower }, { projection: { _id: 1 } });

  if (existing) {
    await col.updateOne(
      { _id: existing._id },
      { $set: { passwordHash, role: "admin", disabled: false, email: EMAIL } },
    );
    console.log(`Account "${USERNAME}" already existed. Password reset, role set to admin, enabled.`);
  } else {
    await col.insertOne({
      _id: randomUUID(),
      username: USERNAME,
      usernameLower,
      email: EMAIL,
      passwordHash,
      role: "admin",
      disabled: false,
      createdAt: new Date(),
      lastLoginAt: null,
    });
    console.log(`Admin account "${USERNAME}" created.`);
  }

  const total = await col.countDocuments({ role: "admin" });
  console.log(`Admin accounts in database: ${total}`);
  console.log("\nSign in at /admin with username \"" + USERNAME + "\" (or email \"" + EMAIL + "\").");
  console.log("CHANGE THIS PASSWORD IMMEDIATELY after the first login.");
} catch (e) {
  console.error(`\nERROR: ${e.message}`);
  if (/auth/i.test(e.message)) console.error("Check the username/password in the connection string.");
  else if (/not authorized|not allowed/i.test(e.message)) console.error("The database user needs read and write access.");
  else console.error("Check Atlas > Network Access allows your IP address.");
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
