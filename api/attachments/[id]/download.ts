import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Storage } from "@google-cloud/storage";
import { sql } from "@vercel/postgres";

// -------------------------
// Config
// -------------------------
const COOKIE_NAME = process.env.COOKIE_NAME || "session"; // ✅ khớp login.ts
const SIGNED_URL_EXPIRES_MS = 5 * 60 * 1000; // 5 phút

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return acc;
    acc[k] = decodeURIComponent(v.join("=") || "");
    return acc;
  }, {} as Record<string, string>);
}

function getCookie(req: VercelRequest, name: string): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[name] || null;
}

function getGcsClient(): Storage {
  const json = process.env.GCS_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error("Missing env: GCS_SERVICE_ACCOUNT_JSON");

  // JSON string trong env
  const credentials = JSON.parse(json);
  return new Storage({ credentials });
}

async function requireSessionUser(req: VercelRequest): Promise<{ user_id: string } | null> {
  const sessionToken = getCookie(req, COOKIE_NAME);
  if (!sessionToken) return null;

  const { rows } = await sql`
    SELECT user_id
    FROM sessions
    WHERE session_token = ${sessionToken}
      AND expires_at > NOW()
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  return { user_id: rows[0].user_id as string };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }

    // 1) Auth: bắt buộc login
    const user = await requireSessionUser(req);
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 2) Validate input
    const id = String(req.query.id || "").trim();
    if (!id) {
      return res.status(400).json({ message: "Missing attachment id" });
    }

    // 3) Load attachment metadata + (optional) check post published
    //    - Nếu anh chưa có bảng posts/published, anh có thể bỏ JOIN và WHERE posts.published
    const { rows } = await sql`
      SELECT
        a.id,
        a.filename,
        a.storage_provider,
        a.storage_key,
        a.content_type,
        a.post_id,
        p.published
      FROM attachments a
      LEFT JOIN posts p ON p.id = a.post_id
      WHERE a.id = ${id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ message: "Attachment not found" });
    }

    const attachment = rows[0] as {
      id: string;
      filename: string;
      storage_provider: string;
      storage_key: string;
      content_type: string | null;
      post_id: string | null;
      published: boolean | null;
    };

    // Nếu attachment không map tới post nào => chặn (tránh download id rác)
    if (!attachment.post_id) {
      return res.status(400).json({ message: "Attachment not linked to a post" });
    }

    // Attachment thuộc post chưa published => chặn (tuỳ anh muốn)
    // Nếu anh muốn "login là tải được kể cả unpublished", thì comment đoạn này.
    if (attachment.published === false) {
      return res.status(403).json({ message: "Post is not published" });
    }

    // 4) Generate signed URL (GCS)
    if (attachment.storage_provider !== "gcs") {
      return res.status(400).json({ message: "Unsupported storage provider" });
    }

    const bucket = process.env.GCS_BUCKET;
    if (!bucket) throw new Error("Missing env: GCS_BUCKET");

    const storage = getGcsClient();
    const file = storage.bucket(bucket).file(attachment.storage_key);

    // 5) Signed URL v4 (read)
    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + SIGNED_URL_EXPIRES_MS,

      // ✅ Ép download + đúng tên file
      responseDisposition: `attachment; filename="${encodeURIComponent(attachment.filename)}"`,

      // (optional) Nếu muốn set content-type response
      // responseType: attachment.content_type ?? undefined,
    });

    // 6) Redirect để browser tải trực tiếp từ GCS
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, signedUrl);
  } catch (err: any) {
    console.error("[download] error:", err?.message || err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
}
