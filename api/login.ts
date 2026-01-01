import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcrypt";
import { Pool } from "pg";
import crypto from "crypto";

/* ==============================
   PostgreSQL connection pool
============================== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/* ==============================
   API: POST /api/login
============================== */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  /* ✅ POST only */
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    const { email, password } = req.body;

    /* ==============================
       1️⃣ Validate input
    ============================== */
    if (!email || !password) {
      return res.status(400).json({
        message: "メールアドレスとパスワードを入力してください",
      });
    }

    /* ==============================
       2️⃣ Find user
    ============================== */
    const result = await pool.query(
      `
      SELECT id, password_hash, status
      FROM users
      WHERE email = $1
      `,
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        message: "メールアドレスまたはパスワードが正しくありません",
      });
    }

    const user = result.rows[0];

    /* ==============================
       3️⃣ Status check (Lv3)
    ============================== */
    if (user.status !== "active") {
      return res.status(403).json({
        message: "メール認証が完了していません",
      });
    }

    /* ==============================
       4️⃣ Password check
    ============================== */
    const isMatch = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!isMatch) {
      return res.status(401).json({
        message: "メールアドレスまたはパスワードが正しくありません",
      });
    }

    /* ==============================
       5️⃣ Create session token
    ============================== */
    const sessionToken = crypto.randomBytes(32).toString("hex");

    /* ==============================
       6️⃣ Save session (DB)
    ============================== */
    await pool.query(
      `
      INSERT INTO sessions (user_id, session_token, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '7 days')
      `,
      [user.id, sessionToken]
    );

    /* ==============================
       7️⃣ Set httpOnly cookie
    ============================== */
    res.setHeader("Set-Cookie", [
      `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Secure`
    ]);

    /* ==============================
       8️⃣ Success
    ============================== */
    return res.status(200).json({
      message: "ログイン成功",
    });

  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "サーバーエラーが発生しました",
    });
  }
}
