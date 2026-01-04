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

function toStr(v: unknown) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const name = toStr(req.body?.name).trim();
  const email = toStr(req.body?.email).trim();
  const phone = toStr(req.body?.phone).trim();
  const password = toStr(req.body?.password);

  // 1) Validate
  if (!name || !email || !phone || !password) {
    return res.status(400).json({ message: "必須項目が不足しています" });
  }

  const normalizedEmail = email.toLowerCase();

  // 2) ENV check (SendGrid)
  const apiKey = process.env.SENDGRID_API_KEY;
  const mailFrom = process.env.MAIL_FROM;

  if (!apiKey || !mailFrom) {
    return res.status(500).json({
      message:
        "メール送信設定が未完了です（SENDGRID_API_KEY / MAIL_FROM を確認してください）",
      debug: {
        hasSendgridKey: Boolean(apiKey),
        hasMailFrom: Boolean(mailFrom),
      },
    });
  }

  // set API key (global)
  sgMail.setApiKey(apiKey);

  const client = await pool.connect();

  // token tạo trước để dùng cho DB + email
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const tokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
  const baseUrl = getBaseUrl(req);

  // ✅ Endpoint verify phải trùng với file API của anh
  // Anh đang dùng verify.ts => /api/verify
  const verifyUrl = `${baseUrl}/api/verify?token=${verificationToken}`;

  try {
    await client.query("BEGIN");

    // 3) Duplicate check
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [
      normalizedEmail,
    ]);
    if (existing.rowCount && existing.rowCount > 0) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ message: "このメールアドレスは既に登録されています" });
    }

    // 4) Hash password
    const passwordHash = await bcrypt.hash(password, 10);

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
      [name, normalizedEmail, phone, passwordHash, verificationToken, tokenExpiresAt]
    );

    // 6) Send email (Option A: catch riêng, log lỗi thật)
    try {
      await sgMail.send({
        to: normalizedEmail,
        from: mailFrom, // MUST be verified in SendGrid (Single Sender or Domain Auth)
        subject: "【ngoc-web】メールアドレス確認",
        html: `
          <p>${name} 様</p>
          <p>以下のリンクをクリックしてメールアドレスを確認してください。</p>
          <p><a href="${verifyUrl}">${verifyUrl}</a></p>
          <p>※リンクの有効期限：1時間</p>
        `,
      });
    } catch (e: any) {
      // ✅ log sâu để thấy lỗi thật (from chưa verify, key permission, v.v.)
      const detail = {
        statusCode: e?.code ?? e?.response?.statusCode,
        message: e?.message,
        errors: e?.response?.body?.errors,
        body: e?.response?.body,
      };

      console.error("SendGrid error detail:", JSON.stringify(detail, null, 2));

      // ❗ email fail => rollback DB để không tạo pending “mồ côi”
      await client.query("ROLLBACK");

      return res.status(502).json({
        message: "メール送信に失敗しました（SendGrid）",
        debug: {
          statusCode: detail.statusCode ?? null,
          errors: detail.errors ?? null,
        },
      });
    }

    // 7) Commit only after email success ✅
    await client.query("COMMIT");

    return res.status(201).json({
      message: "仮登録が完了しました。確認メールをご確認ください。",
    });
  } catch (error: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("Register error:", error);

    return res.status(500).json({
      message: "サーバーエラーが発生しました",
    });
  } finally {
    client.release();
  }
}
