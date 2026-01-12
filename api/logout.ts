import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function clearSessionCookie(isProd: boolean) {
  const parts = [
    "session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (isProd) parts.push("Secure");
  return parts.join("; ");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const isProd = process.env.NODE_ENV === "production";

  try {
    const sessionToken = req.cookies?.session;

    if (sessionToken) {
      await pool.query("DELETE FROM sessions WHERE session_token = $1", [sessionToken]);
    }

    res.setHeader("Set-Cookie", clearSessionCookie(isProd));
    return res.status(204).end();
  } catch (err) {
    console.error("Logout error:", err);
    // ngay cả khi lỗi DB, vẫn nên clear cookie để client side logout “cứng”
    res.setHeader("Set-Cookie", clearSessionCookie(isProd));
    return res.status(500).json({ message: "サーバーエラーが発生しました" });
  }
}
