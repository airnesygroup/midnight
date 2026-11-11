// Server-only: salted PBKDF2-SHA256 password hashes (built into the runtime, no extra service).
const ITER = 100_000;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iter: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${hex(salt)}$${hex(await derive(password, salt, ITER))}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  const [scheme, iter, salt, hash] = (stored ?? "").split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const got = hex(await derive(password, unhex(salt), Number(iter)));
  let diff = got.length ^ hash.length;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ (hash.charCodeAt(i) || 0);
  return diff === 0;
}

export async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return hex(new Uint8Array(buf));
}

export function randomToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}
