import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Pool } from "pg";

/* ==============================
   PostgreSQL connection
============================== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/* ==============================
   API: POST /api/logout
============================== */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  /* ✅ Chỉ cho phép POST */
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    /* 1️⃣ Lấy session token từ cookie */
    const sessionToken = req.cookies?.session;

    if (sessionToken) {
      /* 2️⃣ Xóa session trong DB */
      await pool.query(
        "DELETE FROM sessions WHERE session_token = $1",
        [sessionToken]
      );
    }

    /* 3️⃣ Clear cookie */
    res.setHeader(
      "Set-Cookie",
      "session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax"
    );

    return res.status(200).json({
      message: "ログアウトしました",
    });
  } catch (err) {
    console.error("Logout error:", err);

    return res.status(500).json({
      message: "サーバーエラーが発生しました",
    });
  }
}
