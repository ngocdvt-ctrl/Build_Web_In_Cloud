import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcrypt";
import { Pool } from "pg";
import crypto from "crypto";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // neon/vercel thường cần SSL. Nếu DATABASE_URL của anh đã cấu hình sẵn thì có thể bỏ.
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});

const COOKIE_NAME = process.env.COOKIE_NAME || "session";
const SESSION_DAYS = 7;

function buildSetCookie(token: string) {
  const maxAge = 60 * 60 * 24 * SESSION_DAYS; // seconds
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];

  // Vercel production là https => nên bật Secure
  if (process.env.NODE_ENV === "production") parts.push("Secure");

  return parts.join("; ");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { email, password } = (req.body || {}) as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ message: "メールアドレスとパスワードを入力してください" });
  }

  const client = await pool.connect();
  try {
    // 1) Find user
    const userResult = await client.query(
      `
      SELECT id, password_hash, status, role
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [email]
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({ message: "メールアドレスまたはパスワードが違います" });
    }

    const user = userResult.rows[0];

    // 2) Check status
    if (user.status !== "active") {
      return res.status(403).json({ message: "メール認証が完了していません" });
    }

    // 3) Verify password
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ message: "メールアドレスまたはパスワードが違います" });
    }

    // 4) Create session
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

    await client.query(
      `
      INSERT INTO sessions (user_id, session_token, expires_at)
      VALUES ($1, $2, $3)
      `,
      [user.id, sessionToken, expiresAt]
    );

    // 5) Set cookie
    res.setHeader("Set-Cookie", buildSetCookie(sessionToken));

    return res.status(200).json({
      message: "ログイン成功",
      role: user.role,
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "サーバーエラーが発生しました" });
  } finally {
    client.release();
  }
}
