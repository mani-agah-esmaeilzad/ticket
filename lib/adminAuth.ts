import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const SESSION_COOKIE_NAME = "admin-session";
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getAdminPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_PASSWORD is not defined in environment variables");
  }
  return password;
}

function getTtlMs(): number {
  const envTtl = process.env.ADMIN_SESSION_TTL_MS;
  if (!envTtl) {
    return DEFAULT_SESSION_TTL_MS;
  }
  const parsed = Number(envTtl);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_SESSION_TTL_MS;
  }
  return parsed;
}

function signPayload(payload: string): string {
  return crypto.createHmac("sha256", getAdminPassword()).update(payload).digest("hex");
}

function safeEqual(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(actual, "hex");
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export function validateAdminPassword(password: string): boolean {
  const stored = getAdminPassword();
  if (stored.length !== password.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(password));
}

export function isAdminAuthenticated(): boolean {
  const cookie = cookies().get(SESSION_COOKIE_NAME);
  if (!cookie?.value) {
    return false;
  }
  const [issuedAtStr, signature] = cookie.value.split(".");
  if (!issuedAtStr || !signature) {
    return false;
  }
  const expectedSignature = signPayload(issuedAtStr);
  if (!safeEqual(expectedSignature, signature)) {
    return false;
  }
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) {
    return false;
  }
  return Date.now() - issuedAt < getTtlMs();
}

export async function requireAdmin(): Promise<void> {
  if (!isAdminAuthenticated()) {
    redirect("/admin/login");
  }
}

export function createAdminSession(): void {
  const issuedAt = Date.now().toString();
  const signature = signPayload(issuedAt);
  const ttl = getTtlMs();
  cookies().set(SESSION_COOKIE_NAME, `${issuedAt}.${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: Math.floor(ttl / 1000),
    path: "/"
  });
}

export function destroyAdminSession(): void {
  cookies().set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/"
  });
}
