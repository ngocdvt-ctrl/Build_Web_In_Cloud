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

  // 2) ENV check (SendGrid)
  const apiKey = process.env.SENDGRID_API_KEY;
  const mailFrom = process.env.MAIL_FROM;
  if (!apiKey || !mailFrom) {
    // DB có thể vẫn insert được nhưng email không gửi => báo rõ để debug
    return res.status(500).json({
      message: "メール送信設定が未完了です（SENDGRID_API_KEY / MAIL_FROM を確認してください）",
    });
  }

  sgMail.setApiKey(apiKey);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 3) Duplicate check
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [
      normalizedEmail,
    ]);
    if (existing.rowCount && existing.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "このメールアドレスは既に登録されています" });
    }

    // 4) Hash password
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
      [String(name), normalizedEmail, String(phone), passwordHash, verificationToken, tokenExpiresAt]
    );

    await client.query("COMMIT");

    // 7) Build verify URL (⚠️ endpoint phải đúng với file verify của anh)
    const baseUrl = getBaseUrl(req);
    // Nếu anh đang dùng verify.ts là /api/verify thì giữ nguyên.
    // Nếu anh đang dùng verify-email.ts thì đổi thành /api/verify-email.
    const verifyUrl = `${baseUrl}/api/verify?token=${verificationToken}`;

    // 8) Send email
    await sgMail.send({
      to: normalizedEmail,
      from: mailFrom, // MUST be verified in SendGrid (Single Sender or Domain Auth)
      subject: "【ngoc-web】メールアドレス確認",
      html: `
        <p>${String(name)} 様</p>
        <p>以下のリンクをクリックしてメールアドレスを確認してください。</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>※リンクの有効期限：1時間</p>
      `,
    });

    return res.status(201).json({
      message: "仮登録が完了しました。確認メールをご確認ください。",
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("Register error:", error);
    return res.status(500).json({ message: "サーバーエラーが発生しました" });
  } finally {
    client.release();
  }
}
