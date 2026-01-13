import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "@vercel/postgres";

const COOKIE_NAME = process.env.COOKIE_NAME || "session";

// ==============================
// Utils
// ==============================
function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return acc;
    acc[k] = decodeURIComponent(v.join("=") || "");
    return acc;
  }, {} as Record<string, string>);
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

async function requireSession(req: VercelRequest): Promise<boolean> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return false;

  const { rows } = await sql`
    SELECT 1
    FROM sessions
    WHERE session_token = ${token}
      AND expires_at > NOW()
    LIMIT 1
  `;
  return rows.length > 0;
}

// ==============================
// Handler
// GET /api/posts/:id/attachments
// ==============================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    // 1) Auth: bắt buộc login (vì file download cũng bắt login)
    const ok = await requireSession(req);
    if (!ok) return res.status(401).json({ message: "Unauthorized" });

    // 2) Validate post id
    const postId = String(req.query.id || "").trim();
    if (!postId) return res.status(400).json({ message: "Missing post id" });
    if (!isUuid(postId)) return res.status(400).json({ message: "Invalid post id" });

    // 3) Ensure post exists & published, then load attachments
    const { rows } = await sql`
      SELECT
        a.id,
        a.filename,
        a.content_type,
        a.created_at
      FROM attachments a
      JOIN posts p ON p.id = a.post_id
      WHERE a.post_id = ${postId}
        AND p.published = TRUE
      ORDER BY a.created_at ASC
    `;

    // 4) Return list (empty array is OK)
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(rows);
  } catch (e) {
    console.error("[posts/attachments] error:", e);
    return res.status(500).json({ message: "Internal Server Error" });
  }
}
