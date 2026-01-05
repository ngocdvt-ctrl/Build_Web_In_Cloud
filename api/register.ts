import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcrypt";
import { Pool } from "pg";
import crypto from "crypto";
import sgMail from "@sendgrid/mail";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Base URL dùng để tạo link verify (cloud/local)
function getBaseUrl(req: VercelRequest) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const host = req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  return `${proto}://${host}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { name, email, phone, password } = req.body ?? {};

  // 1) Validate
  if (!name || !email || !phone || !password) {
    return res.status(400).json({ message: "必須項目が不足しています" });
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  const client = await pool.connect();

  let verificationToken = "";
  let tokenExpiresAt: Date | null = null;

  try {
    await client.query("BEGIN");

    // 2) Duplicate check
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [
      normalizedEmail,
    ]);
    if (existing.rowCount && existing.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "このメールアドレスは既に登録されています" });
    }

    // 3) Hash password
    const passwordHash = await bcrypt.hash(String(password), 10);

    // 4) Token + expiry
    verificationToken = crypto.randomBytes(32).toString("hex");
    tokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    // 5) Insert pending user
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
      [String(name), normalizedEmail, String(phone), passwordHash, verificationToken, tokenExpiresAt]
    );

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("Register error:", error);
    return res.status(500).json({ message: "サーバーエラーが発生しました" });
  } finally {
    client.release();
  }

  // ====== IMPORTANT: email send is BEST-EFFORT (do not fail registration) ======
  let emailSent = false;

  try {
    const apiKey = process.env.SENDGRID_API_KEY;
    const mailFrom = process.env.MAIL_FROM;

    if (!apiKey || !mailFrom) {
      // Không fail register, chỉ log để anh debug
      console.warn(
        "[register] SendGrid env missing. SENDGRID_API_KEY or MAIL_FROM is not set."
      );
    } else {
      sgMail.setApiKey(apiKey);

      const baseUrl = getBaseUrl(req);
      const verifyUrl = `${baseUrl}/api/verify?token=${verificationToken}`;

      await sgMail.send({
        to: normalizedEmail,
        from: mailFrom, // MUST be verified in SendGrid
        subject: "【ngoc-web】メールアドレス確認",
        html: `
          <p>${String(name)} 様</p>
          <p>以下のリンクをクリックしてメールアドレスを確認してください。</p>
          <p><a href="${verifyUrl}">${verifyUrl}</a></p>
          <p>※リンクの有効期限：1時間</p>
        `,
      });

      emailSent = true;
    }
  } catch (error) {
    // Không fail register
    console.error("[register] Send verification email failed:", error);
  }

  // Trả 201 dù email fail
  return res.status(201).json({
    message: emailSent
      ? "仮登録が完了しました。確認メールをご確認ください。"
      : "仮登録が完了しました。確認メール送信に失敗した可能性があります。届かない場合は再送してください。",
    emailSent,
  });
}
