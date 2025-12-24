import { db } from '@vercel/postgres';
import { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * ユーザー登録処理 (Backend API)
 * Vercel Serverless Function
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. POSTメソッド以外は許可しない (メソッド制限)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '許可されていないメソッドです。' });
  }

  // 2. フロントエンドから送信されたデータを取得
  const { username, password } = req.body;

  // 3. 入力チェック (バリデーション)
  if (!username || !password) {
    return res.status(400).json({ error: 'IDとパスワードを入力してください。' });
  }

  try {
    // 4. Vercel Postgres への接続
    const client = await db.connect();

    // 5. データベース(Neon)の 'users' テーブルにデータを挿入
    // usernameは一意(UNIQUE)である必要があります
    await client.sql`
      INSERT INTO users (username, password) 
      VALUES (${username}, ${password});
    `;

    // 6. 成功時のレスポンス
    return res.status(200).json({ message: "会員登録が完了しました！" });

  } catch (error: any) {
    // 7. エラーハンドリング (ID重複チェックなど)
    // Postgresのエラーコード '23505' は一意制約違反(重複)を意味します
    if (error.code === '23505') {
      return res.status(400).json({ error: 'このIDは既に登録されています。' });
    }

    // その他のサーバーエラー
    console.error('Database Error:', error);
    return res.status(500).json({ error: "データベース接続エラーが発生しました。" });
  }
}