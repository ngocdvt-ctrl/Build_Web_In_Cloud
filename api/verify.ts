import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Pool } from "pg";

/* ==============================
   PostgreSQL connection pool
============================== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/* ==============================
   API: GET /api/verify-email?token=...
============================== */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ✅ Only GET
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const token = req.query.token;

  if (!token || typeof token !== "string") {
    return res.status(400).send("無効なリンクです");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* ==============================
       1) Find user by token (pending only)
    ============================== */
    const result = await client.query(
      `
      SELECT id, verification_token_expires_at
      FROM users
      WHERE verification_token = $1
        AND status = 'pending'
      FOR UPDATE
      `,
      [token]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).send("無効または期限切れのリンクです");
    }

    const user = result.rows[0];

    /* ==============================
       2) Check token expiration
       (NULL safety)
    ============================== */
    if (
      !user.verification_token_expires_at ||
      new Date(user.verification_token_expires_at) < new Date()
    ) {
      await client.query("ROLLBACK");
      return res.status(400).send("リンクの有効期限が切れています");
    }

    /* ==============================
       3) Activate user + set verified timestamp
    ============================== */
    await client.query(
      `
      UPDATE users
      SET
        status = 'active',
        email_verified_at = NOW(),
        verification_token = NULL,
        verification_token_expires_at = NULL,
        updated_at = NOW()
      WHERE id = $1
      `,
      [user.id]
    );

    await client.query("COMMIT");

    /* ==============================
       4) Redirect to success page
    ============================== */
    return res.redirect("/register-success.html");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("Verify email error:", error);
    return res.status(500).send("サーバーエラーが発生しました");
  } finally {
    client.release();
  }
}
