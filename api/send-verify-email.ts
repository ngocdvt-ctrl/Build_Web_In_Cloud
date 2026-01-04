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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    const { email } = req.body ?? {};
    const normalizedEmail = String(email || "").toLowerCase().trim();

    if (!normalizedEmail) {
      return res.status(400).json({ message: "メールアドレスが不正です" });
    }

    // ENV check (SendGrid)
    const apiKey = process.env.SENDGRID_API_KEY;
    const mailFrom = process.env.MAIL_FROM;
    if (!apiKey || !mailFrom) {
      return res.status(500).json({
        message: "メール送信設定が未完了です（SENDGRID_API_KEY / MAIL_FROM を確認してください）",
      });
    }

    sgMail.setApiKey(apiKey);

    // Find user + token (pending)
    const client = await pool.connect();
    try {
      const result = await client.query(
        `
        SELECT id, name, verification_token, verification_token_expires_at, status
        FROM users
        WHERE email = $1
        LIMIT 1
        `,
        [normalizedEmail]
      );

      // Ẩn thông tin tồn tại/không tồn tại để tránh leak
      if (result.rowCount === 0) {
        return res.status(200).json({ message: "OK" });
      }

      const user = result.rows[0];

      // Chỉ gửi cho pending
      if (user.status !== "pending") {
        return res.status(200).json({ message: "OK" });
      }

      if (!user.verification_token) {
        return res.status(400).json({ message: "確認用トークンが見つかりません。再登録してください。" });
      }

      // Optional: check expiry nếu cột tồn tại
      if (user.verification_token_expires_at) {
        const exp = new Date(user.verification_token_expires_at);
        if (exp < new Date()) {
          return res.status(400).json({ message: "リンクの有効期限が切れています。再登録してください。" });
        }
      }

      const baseUrl = getBaseUrl(req);

      // ✅ endpoint verify: anh đang dùng verify.ts => /api/verify
      // Nếu anh đổi thành /api/verify-email thì sửa lại ở đây.
      const verifyUrl = `${baseUrl}/api/verify?token=${user.verification_token}`;

      await sgMail.send({
        to: normalizedEmail,
        from: mailFrom, // must be verified in SendGrid
        subject: "【ngoc-web】メールアドレス確認",
        html: `
          <p>${user.name || "ユーザー"} 様</p>
          <p>以下のリンクをクリックしてメールアドレスを確認してください。</p>
          <p><a href="${verifyUrl}">${verifyUrl}</a></p>
          <p>※リンクの有効期限：1時間</p>
        `,
      });

      return res.status(200).json({ message: "確認メールを送信しました" });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("Send verify email error:", error);

    // SendGrid lỗi thường có response.body.errors
    const statusCode = error?.code || error?.response?.statusCode;
    const errors = error?.response?.body?.errors;

    return res.status(502).json({
      message: "メール送信に失敗しました（SendGrid）",
      debug: statusCode || errors ? { statusCode, errors } : undefined,
    });
  }
}
