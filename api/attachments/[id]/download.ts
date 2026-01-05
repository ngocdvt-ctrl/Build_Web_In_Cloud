import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Storage } from "@google-cloud/storage";
import { sql } from "@vercel/postgres";

const COOKIE_NAME = process.env.COOKIE_NAME || "session";
const SIGNED_URL_EXPIRES_MS = 5 * 60 * 1000; // 5 phút
const DEBUG_ERRORS = process.env.DEBUG_ERRORS === "true";

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return acc;
    acc[k] = decodeURIComponent(v.join("=") || "");
    return acc;
  }, {} as Record<string, string>);
}

function getGcsClient(): Storage {
  const b64 = process.env.GCS_SERVICE_ACCOUNT_JSON_B64;
  if (!b64) throw new Error("Missing env: GCS_SERVICE_ACCOUNT_JSON_B64");

  let json: string;
  try {
    json = Buffer.from(b64, "base64").toString("utf8");
  } catch {
    throw new Error("Invalid base64 in GCS_SERVICE_ACCOUNT_JSON_B64");
  }

  let credentials: any;
  try {
    credentials = JSON.parse(json);
  } catch {
    throw new Error("Decoded JSON is invalid (JSON.parse failed)");
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("GCS credentials missing client_email/private_key");
  }

  return new Storage({ credentials });
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }

    // 1) Auth: bắt buộc login
    const ok = await requireSession(req);
    if (!ok) return res.status(401).json({ message: "Unauthorized" });

    // 2) Validate input
    const id = String(req.query.id || "").trim();
    if (!id) return res.status(400).json({ message: "Missing attachment id" });

    // 3) Load attachment metadata from DB
    const { rows } = await sql`
      SELECT id, filename, storage_provider, storage_key, content_type
      FROM attachments
      WHERE id = ${id}
      LIMIT 1
    `;
    if (rows.length === 0) return res.status(404).json({ message: "Attachment not found" });

    const attachment = rows[0] as {
      id: string;
      filename: string;
      storage_provider: string;
      storage_key: string;
      content_type: string | null;
    };

    if (attachment.storage_provider !== "gcs") {
      return res.status(400).json({ message: "Unsupported storage provider" });
    }

    // 4) Bucket env
    const bucket = process.env.GCS_BUCKET;
    if (!bucket) throw new Error("Missing env: GCS_BUCKET");

    // 5) Generate signed URL (INLINE open)
    const storage = getGcsClient();
    const file = storage.bucket(bucket).file(attachment.storage_key);

    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + SIGNED_URL_EXPIRES_MS,

      // ✅ quan trọng: inline để browser mở trực tiếp (PDF/images...)
      responseDisposition: `inline; filename="${encodeURIComponent(attachment.filename)}"`,

      // ✅ gợi ý content-type cho browser (đặc biệt hữu ích với PDF)
      responseType: attachment.content_type ?? undefined,
    });

    // 6) Redirect to signed URL
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, signedUrl);
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("[download:inline] error:", msg);

    if (DEBUG_ERRORS) {
      return res.status(500).json({ message: "Internal Server Error", debug: msg });
    }
    return res.status(500).json({ message: "Internal Server Error" });
  }
}
