import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

/* ==============================
   Helpers
============================== */
function clearSessionCookie(res: VercelResponse) {
  const isProduction = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    [
      "session=",
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
      isProduction ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ")
  );
}

function isValidName(name: unknown): name is string {
  return typeof name === "string" && name.trim().length >= 1 && name.length <= 100;
}

/**
 * Normalize phone input:
 * - undefined -> do not update field
 * - null or "" (after trim) -> set NULL (clear phone)
 * - string length > 30 -> invalid (return undefined to signal invalid)
 */
function normalizePhone(phone: unknown): string | null | undefined {
  if (phone === undefined) return undefined; // do not update
  if (phone === null) return null; // clear
  if (typeof phone !== "string") return undefined; // invalid type
  const v = phone.trim();
  if (v.length === 0) return null; // treat empty as clear
  if (v.length > 30) return undefined; // invalid length
  return v;
}

function isValidEmail(email: unknown): email is string {
  return (
    typeof email === "string" &&
    email.includes("@") &&
    email.length <= 255
  );
}


/** Get session token, or return 401 */
function getSessionToken(req: VercelRequest, res: VercelResponse): string | null {
  const sessionToken = req.cookies?.session;
  if (!sessionToken) {
    res.status(401).json({ message: "ログインしていません" });
    return null;
  }
  return sessionToken;
}

/* ==============================
   Handler
============================== */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow only GET / PATCH
  if (req.method !== "GET" && req.method !== "PATCH") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const sessionToken = getSessionToken(req, res);
  if (!sessionToken) return;

  // ===========================
  // GET /api/me
  // ===========================
  if (req.method === "GET") {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `
        SELECT
          u.id,
          u.name,
          u.email,
          u.phone,
          u.role,
          u.status
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.session_token = $1
          AND s.expires_at > now()
        LIMIT 1
        `,
        [sessionToken]
      );

      if (result.rowCount === 0) {
        clearSessionCookie(res);
        return res.status(401).json({ message: "セッションが無効です" });
      }

      const user = result.rows[0];

      if (user.status !== "active") {
        clearSessionCookie(res);
        return res.status(403).json({ message: "アカウントが有効ではありません" });
      }

      // Rolling session
      const newExpiresAt = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000);
      await client.query(
        `UPDATE sessions SET expires_at = $1 WHERE session_token = $2`,
        [newExpiresAt, sessionToken]
      );

      return res.status(200).json({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      });
    } catch (err) {
      console.error("GET /api/me error:", err);
      return res.status(500).json({ message: "サーバーエラーが発生しました" });
    } finally {
      client.release();
    }
  }

  // ===========================
  // PATCH /api/me
  // ===========================
  // Only allow updating name + email + phone
  const { name, email, phone } = req.body ?? {};

  if (!isValidName(name)) {
    return res.status(400).json({ message: "名前が不正です（1〜100文字）" });
  }

  const normalizedPhone = normalizePhone(phone);
  if (phone !== undefined && normalizedPhone === undefined) {
    return res.status(400).json({ message: "電話番号が不正です（最大30文字）" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock session row to prevent races
    const sessionResult = await client.query(
      `
      SELECT u.id, u.status
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.session_token = $1
        AND s.expires_at > now()
      FOR UPDATE
      `,
      [sessionToken]
    );

    if (sessionResult.rowCount === 0) {
      await client.query("ROLLBACK");
      clearSessionCookie(res);
      return res.status(401).json({ message: "セッションが無効です" });
    }

    const me = sessionResult.rows[0];
    if (me.status !== "active") {
      await client.query("ROLLBACK");
      clearSessionCookie(res);
      return res.status(403).json({ message: "アカウントが有効ではありません" });
    }

    // Update
    // If phone was omitted (undefined), keep current value by using COALESCE with existing phone
    // But simplest: if undefined -> do not touch phone column.
    // We'll do conditional SQL based on whether phone is provided.
    let updateResult;
    if (phone === undefined) {
      updateResult = await client.query(
        `
        UPDATE users
        SET name = $1,
            updated_at = now()
        WHERE id = $2
        RETURNING id, name, email, phone, role
        `,
        [name.trim(), me.id]
      );
    } else {
      updateResult = await client.query(
        `
        UPDATE users
        SET name = $1,
            phone = $2,
            updated_at = now()
        WHERE id = $3
        RETURNING id, name, email, phone, role
        `,
        [name.trim(), normalizedPhone ?? null, me.id]
      );
    }

    // Rolling session on PATCH as well (nice UX)
    const newExpiresAt = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000);
    await client.query(
      `UPDATE sessions SET expires_at = $1 WHERE session_token = $2`,
      [newExpiresAt, sessionToken]
    );

    await client.query("COMMIT");

    const u = updateResult.rows[0];
    return res.status(200).json({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PATCH /api/me error:", err);
    return res.status(500).json({ message: "サーバーエラーが発生しました" });
  } finally {
    client.release();
  }
}
