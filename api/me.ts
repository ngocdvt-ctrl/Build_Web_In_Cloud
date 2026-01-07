import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const sessionToken = req.cookies?.session;

  if (!sessionToken) {
    return res.status(401).json({ message: "ログインしていません" });
  }

  const client = await pool.connect();

  try {
    /* 1) Check session + user */
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
      JOIN users u
        ON u.id = s.user_id
      WHERE s.session_token = $1
        AND s.expires_at > now()
      LIMIT 1
      `,
      [sessionToken]
    );

    if (result.rowCount === 0) {
      // session invalid -> clear cookie
      clearSessionCookie(res);
      return res.status(401).json({ message: "セッションが無効です" });
    }

    const user = result.rows[0];

    /* 2) Optional status check */
    if (user.status !== "active") {
      clearSessionCookie(res);
      return res.status(403).json({ message: "アカウントが有効ではありません" });
    }

    /* 3) (Optional but recommended) Rolling session: extend expires_at */
    const newExpiresAt = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000);
    await client.query(
      `UPDATE sessions SET expires_at = $1 WHERE session_token = $2`,
      [newExpiresAt, sessionToken]
    );

    /* 4) Return user info */
    return res.status(200).json({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    });
  } catch (err) {
    console.error("Me API error:", err);
    return res.status(500).json({ message: "サーバーエラーが発生しました" });
  } finally {
    client.release();
  }
}
