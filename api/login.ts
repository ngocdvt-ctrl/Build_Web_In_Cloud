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
  /* ✅ Method check */
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  /* ==============================
     1️⃣ Validate input
  ============================== */
  if (!email || !password) {
    return res.status(400).json({
      message: "メールアドレスとパスワードを入力してください",
    });
  }

  const client = await pool.connect();

  try {
    /* ==============================
       2️⃣ Find user by email
    ============================== */
    const userResult = await client.query(
      `
      SELECT id, password_hash, status, role
      FROM users
      WHERE email = $1
      `,
      [email]
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({
        message: "メールアドレスまたはパスワードが違います",
      });
    }

    const user = userResult.rows[0];

    /* ==============================
       3️⃣ Check user status
    ============================== */
    if (user.status !== "active") {
      return res.status(403).json({
        message: "メール認証が完了していません",
      });
    }

    /* ==============================
       4️⃣ Verify password (bcrypt)
    ============================== */
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        message: "メールアドレスまたはパスワードが違います",
      });
    }

    /* ==============================
       5️⃣ Create session
    ============================== */
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
    );

    await client.query(
      `
      INSERT INTO sessions (user_id, session_token, expires_at)
      VALUES ($1, $2, $3)
      `,
      [user.id, sessionToken, expiresAt]
    );

    /* ==============================
       6️⃣ Set httpOnly cookie
    ============================== */
    const isProduction = process.env.NODE_ENV === "production";

    res.setHeader(
      "Set-Cookie",
      [
        `session=${sessionToken}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${60 * 60 * 24 * 7}`, // 7 days
        isProduction ? "Secure" : "",
      ].filter(Boolean).join("; ")
    );

    /* ==============================
       7️⃣ Success response
    ============================== */
    return res.status(200).json({
      message: "ログイン成功",
      role: user.role, // optional (frontend dùng)
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "サーバーエラーが発生しました",
    });
  } finally {
    client.release();
  }
}

