import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Pool } from "pg";
import sgMail from "@sendgrid/mail";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function getBaseUrl(req: VercelRequest) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const host = req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  return `${proto}://${host}`;
}

function makeReqId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const COOLDOWN_SEC = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const reqId = makeReqId("resend");
  console.log("[resend] start", { reqId, method: req.method });

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed", reqId });
  }

  const { email } = req.body ?? {};
  const normalizedEmail = String(email || "").toLowerCase().trim();

  if (!normalizedEmail) {
    return res.status(400).json({ message: "メールアドレスが不正です", reqId });
  }

  // ENV check (SendGrid)
  const apiKey = process.env.SENDGRID_API_KEY;
  const mailFrom = process.env.MAIL_FROM;
  if (!apiKey || !mailFrom) {
    return res.status(500).json({
      message: "メール送信設定が未完了です（SENDGRID_API_KEY / MAIL_FROM を確認してください）",
      reqId,
    });
  }
  sgMail.setApiKey(apiKey);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock row để chống 2 request đồng thời
    const result = await client.query(
      `
      SELECT
        id,
        name,
        status,
        verification_token,
        verification_token_expires_at,
        last_verification_email_sent_at
      FROM users
      WHERE email = $1
      LIMIT 1
      FOR UPDATE
      `,
      [normalizedEmail]
    );

    // Ẩn tồn tại/không tồn tại
    if (result.rowCount === 0) {
      await client.query("COMMIT");
      console.log("[resend] user not found (hidden)", { reqId, email: normalizedEmail });
      return res.status(200).json({ message: "OK", reqId });
    }

    const user = result.rows[0];

    // Chỉ gửi cho pending
    if (user.status !== "pending") {
      await client.query("COMMIT");
      console.log("[resend] status not pending (hidden)", {
        reqId,
        email: normalizedEmail,
        status: user.status,
      });
      return res.status(200).json({ message: "OK", reqId });
    }

    if (!user.verification_token) {
      await client.query("COMMIT");
      return res.status(400).json({
        message: "確認用トークンが見つかりません。再登録してください。",
        reqId,
      });
    }

    // Check expiry
    if (user.verification_token_expires_at) {
      const exp = new Date(user.verification_token_expires_at);
      if (exp < new Date()) {
        await client.query("COMMIT");
        return res.status(400).json({
          message: "リンクの有効期限が切れています。再登録してください。",
          reqId,
        });
      }
    }

    // Throttle
    const lastSent = user.last_verification_email_sent_at
      ? new Date(user.last_verification_email_sent_at).getTime()
      : 0;

    const now = Date.now();
    const elapsedSec = lastSent ? Math.floor((now - lastSent) / 1000) : 999999;

    if (elapsedSec < COOLDOWN_SEC) {
      const cooldownRemainingSec = COOLDOWN_SEC - elapsedSec;
      await client.query("COMMIT");
      console.log("[resend] throttled", {
        reqId,
        email: normalizedEmail,
        cooldownRemainingSec,
      });
      return res.status(200).json({
        message: "OK",
        cooldownRemainingSec,
        reqId,
      });
    }

    const baseUrl = getBaseUrl(req);
    const verifyUrl = `${baseUrl}/api/verify?token=${user.verification_token}`;

    await sgMail.send({
      to: normalizedEmail,
      from: mailFrom,
      subject: `【ngoc-web registration再送】メールアドレス確認 (reqId=${reqId})`,
      html: `
        <p>${user.name || "ユーザー"} 様</p>
        <p>以下のリンクをクリックしてメールアドレスを確認してください。</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>※リンクの有効期限：1時間</p>
      `,
    });

    await client.query(
      `
      UPDATE users
      SET last_verification_email_sent_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      `,
      [user.id]
    );

    await client.query("COMMIT");

    console.log("[resend] email sent", { reqId, email: normalizedEmail });

    return res.status(200).json({
      message: "確認メールを送信しました",
      cooldownRemainingSec: COOLDOWN_SEC,
      reqId,
    });
  } catch (error: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("[resend] error", {
      reqId,
      email: normalizedEmail,
      error,
      statusCode: error?.response?.statusCode,
      errors: error?.response?.body?.errors,
    });

    const statusCode = error?.code || error?.response?.statusCode;
    const errors = error?.response?.body?.errors;

    return res.status(502).json({
      message: "メール送信に失敗しました（SendGrid）",
      debug: statusCode || errors ? { statusCode, errors } : undefined,
      reqId,
    });
  } finally {
    client.release();
  }
}
