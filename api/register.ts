import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcrypt";
import { Pool } from "pg";
import crypto from "crypto";
import sgMail from "@sendgrid/mail";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Base URL để build link verify (cloud / local)
function getBaseUrl(req: VercelRequest) {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, "");
  }
  const host = req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  return `${proto}://${host}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { name, email, phone, password } = req.body ?? {};

  /* ==============================
     1) Validate input
  ============================== */
  if (!name || !email || !phone || !password) {
    return res.status(400).json({
      message: "必須項目が不足しています",
    });
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  const client = await pool.connect();

  let verificationToken = "";
  let tokenExpiresAt: Date;

  try {
    await client.query("BEGIN");

    /* ==============================
       2) Prepare data
    ============================== */
    const passwordHash = await bcrypt.hash(String(password), 10);
    verificationToken = crypto.randomBytes(32).toString("hex");
    tokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    /* ==============================
       3) Atomic insert (NO race)
       - UNIQUE(email) enforced in DB
    ============================== */
    const result = await client.query(
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
      ON CONFLICT (email) DO NOTHING
      RETURNING id
      `,
      [
        String(name),
        normalizedEmail,
        String(phone),
        passwordHash,
        verificationToken,
        tokenExpiresAt,
      ]
    );

    // Email đã tồn tại → không gửi mail
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "このメールアドレスは既に登録されています",
      });
    }

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("[register] DB error:", error);
    return res.status(500).json({
      message: "サーバーエラーが発生しました",
    });
  } finally {
    client.release();
  }

  /* ==============================
     4) Best-effort send mail
     - Mail fail ≠ register fail
  ============================== */
  let emailSent = false;

  try {
    const apiKey = process.env.SENDGRID_API_KEY;
    const mailFrom = process.env.MAIL_FROM;

    if (!apiKey || !mailFrom) {
      console.warn(
        "[register] SendGrid env missing (SENDGRID_API_KEY / MAIL_FROM)"
      );
    } else {
      sgMail.setApiKey(apiKey);

      const baseUrl = getBaseUrl(req);
      const verifyUrl = `${baseUrl}/api/verify?token=${verificationToken}`;

      await sgMail.send({
        to: normalizedEmail,
        from: mailFrom, // must be verified in SendGrid
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
    console.error("[register] Send mail failed:", error);
  }

  /* ==============================
     5) Response
  ============================== */
  return res.status(201).json({
    message: emailSent
      ? "仮登録が完了しました。確認メールをご確認ください。"
      : "仮登録が完了しました。確認メールが届かない場合は再送してください。",
    emailSent,
  });
}
