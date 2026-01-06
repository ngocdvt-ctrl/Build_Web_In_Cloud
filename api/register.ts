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
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const host = req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  return `${proto}://${host}`;
}

function makeReqId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const reqId = makeReqId("reg");
  console.log("[register] start", { reqId, method: req.method });

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed", reqId });
  }

  const { name, email, phone, password } = req.body ?? {};

  // 1) Validate
  if (!name || !email || !phone || !password) {
    return res.status(400).json({ message: "必須項目が不足しています", reqId });
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  const client = await pool.connect();

  let verificationToken = "";
  let tokenExpiresAt: Date;

  try {
    await client.query("BEGIN");

    // 2) Prepare data
    const passwordHash = await bcrypt.hash(String(password), 10);
    verificationToken = crypto.randomBytes(32).toString("hex");
    tokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    // 3) Atomic insert (requires UNIQUE(email) in DB)
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

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      console.log("[register] conflict", { reqId, email: normalizedEmail });
      return res.status(409).json({
        message: "このメールアドレスは既に登録されています",
        reqId,
      });
    }

    await client.query("COMMIT");
    console.log("[register] committed", { reqId, email: normalizedEmail });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("[register] DB error", { reqId, error });
    return res.status(500).json({ message: "サーバーエラーが発生しました", reqId });
  } finally {
    client.release();
  }

  // 4) Best-effort send mail (mail fail != register fail)
  let emailSent = false;

  try {
    const apiKey = process.env.SENDGRID_API_KEY;
    const mailFrom = process.env.MAIL_FROM;

    if (!apiKey || !mailFrom) {
      console.warn("[register] SendGrid env missing", {
        reqId,
        hasApiKey: !!apiKey,
        hasMailFrom: !!mailFrom,
      });
    } else {
      sgMail.setApiKey(apiKey);

      const baseUrl = getBaseUrl(req);
      const verifyUrl = `${baseUrl}/api/verify?token=${verificationToken}`;

      await sgMail.send({
        to: normalizedEmail,
        from: mailFrom,
        subject: `【ngoc-web】メールアドレス確認 (reqId=${reqId})`,
        html: `
          <p><strong>reqId:</strong> ${reqId}</p>
          <p>${String(name)} 様</p>
          <p>以下のリンクをクリックしてメールアドレスを確認してください。</p>
          <p><a href="${verifyUrl}">${verifyUrl}</a></p>
          <p>※リンクの有効期限：1時間</p>
        `,
      });

      emailSent = true;
      console.log("[register] email sent", { reqId, email: normalizedEmail });
    }
  } catch (error: any) {
    console.error("[register] Send mail failed", {
      reqId,
      email: normalizedEmail,
      error,
      statusCode: error?.response?.statusCode,
      errors: error?.response?.body?.errors,
    });
  }

  return res.status(201).json({
    message: emailSent
      ? "仮登録が完了しました。確認メールをご確認ください。"
      : "仮登録が完了しました。確認メールが届かない場合は再送してください。",
    emailSent,
    reqId,
  });
}
