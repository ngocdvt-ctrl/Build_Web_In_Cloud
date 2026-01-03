import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcrypt";
import { Pool } from "pg";
import crypto from "crypto";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function getBaseUrl(req: VercelRequest) {
  // Ưu tiên env khi deploy
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  // Fallback cho local/dev
  const host = req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  return `${proto}://${host}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const client = await pool.connect();

  try {
    const { name, email, phone, password } = req.body ?? {};

    // 1) Validate
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: "必須項目が不足しています" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    // 2) Begin
    await client.query("BEGIN");

    // 3) Duplicate check
    const existing = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existing.rowCount && existing.rowCount > 0) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ message: "このメールアドレスは既に登録されています" });
    }

    // 4) Hash
    const passwordHash = await bcrypt.hash(String(password), 10);

    // 5) Token + expiry
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    // 6) Insert pending user
    await client.query(
      `
      INSERT INTO users (
        name,
        email,
        phone,
        password_hash,
        role,
        status,
        verification_token,
        verification_token_expires_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 'user', 'pending', $5, $6, NOW(), NOW())
      `,
      [name, normalizedEmail, phone, passwordHash, verificationToken, tokenExpiresAt]
    );

    // 7) Commit DB
    await client.query("COMMIT");

    // 8) DEV: log verify URL (Option A)
    const baseUrl = getBaseUrl(req);
    const verifyUrl = `${baseUrl}/api/verify?token=${verificationToken}`;

    console.log(`[DEV] Verify URL: ${verifyUrl}`);

    // Trả về message để frontend redirect sang register-pending.html
    return res.status(201).json({
      message: "仮登録が完了しました（開発中：メールは送信せずURLをログ出力します）。",
      verifyUrl, // tiện test; sau này production có thể bỏ field này
    });
  } catch (error) {
    // rollback chỉ khi transaction đang mở
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("Register error:", error);
    return res.status(500).json({ message: "サーバーエラーが発生しました" });
  } finally {
    client.release();
  }
}
