import { db } from '@vercel/postgres'; // Kết nối Database Vercel
import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    const { id, password } = req.body;
    
    // Logic lưu vào Database
    try {
      const client = await db.connect();
      await client.sql`INSERT INTO users (username, password) VALUES (${id}, ${password});`;
      return res.status(200).json({ message: "Đăng ký thành công!" });
    } catch (error) {
      return res.status(500).json({ error: "Lỗi kết nối Database" });
    }
  }
  return res.status(405).send('Method Not Allowed');
}