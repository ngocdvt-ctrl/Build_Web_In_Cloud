import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const id = String(req.query.id || "").trim();
  if (!id) return res.status(400).json({ message: "Invalid id" });

  try {
    const { rows } = await pool.query(
      `SELECT id, title, content, created_at
       FROM posts
       WHERE id = $1 AND published = TRUE
       LIMIT 1`,
      [id]
    );

    if (rows.length === 0) return res.status(404).json({ message: "Not Found" });

    return res.status(200).json(rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Internal Server Error" });
  }
}
