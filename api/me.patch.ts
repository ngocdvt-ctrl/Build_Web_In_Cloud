import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Pool } from "pg";

/* ==============================
   PostgreSQL connection
============================== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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
    ].filter(Boolean).join("; ")
  );
}

function isValidName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.trim().length >= 1 &&
    name.length <= 100
  );
}

function isValidPhone(phone: unknown): phone is string {
  return (
    typeof phone === "string" &&
    phone.length <= 30
  );
}

/* ==============================
   API: PATCH /api/me
============================== */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  /* ✅ Method check */
  if (req.method !== "PATCH") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const sessionToken = req.cookies?.session;
  if (!sessionToken) {
    return res.status(401).json({ message: "ログインしていません" });
  }

  const { name, phone } = req.body ?? {};

  /* ✅ Validation */
  if (!isValidName(name)) {
    return res.status(400).json({
      message: "名前が不正です（1〜100文字）",
    });
  }

  if (phone !== undefined && !isValidPhone(phone)) {
    return res.status(400).json({
      message: "電話番号が不正です",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Check session + user */
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

    const user = sessionResult.rows[0];

    if (user.status !== "active") {
      await client.query("ROLLBACK");
      clearSessionCookie(res);
      return res.status(403).json({
        message: "アカウントが有効ではありません",
      });
    }

    /* 2️⃣ Update profile (ONLY name, phone) */
    const updateResult = await client.query(
      `
      UPDATE users
      SET
        name = $1,
        phone = $2,
        updated_at = now()
      WHERE id = $3
      RETURNING id, name, email, role
      `,
      [name.trim(), phone ?? null, user.id]
    );

    await client.query("COMMIT");

    /* 3️⃣ Return updated user */
    return res.status(200).json({
      id: updateResult.rows[0].id,
      name: updateResult.rows[0].name,
      email: updateResult.rows[0].email,
      role: updateResult.rows[0].role,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PATCH /api/me error:", err);

    return res.status(500).json({
      message: "サーバーエラーが発生しました",
    });
  } finally {
    client.release();
  }
}
