"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const postgres_1 = require("@vercel/postgres");
/**
 * 認証処理 (会員登録 & ログイン)
 */
async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'メソッドが許可されていません。' });
    }
    const { action, username, password } = req.body;
    // 入力チェック
    if (!username || !password) {
        return res.status(400).json({ error: 'IDとパスワードを正しく入力してください。' });
    }
    try {
        const client = await postgres_1.db.connect();
        // --- 会員登録処理 (Register) ---
        if (action === 'register') {
            try {
                await client.sql `
          INSERT INTO users (username, password) 
          VALUES (${username}, ${password});
        `;
                return res.status(200).json({ message: "会員登録が完了しました！" });
            }
            catch (dbError) {
                // IDが既に存在する場合のエラーハンドリング (Error code 23505)
                if (dbError.code === '23505') {
                    return res.status(400).json({ error: 'このIDは既に登録されています。' });
                }
                throw dbError; // 他のDBエラーは外側のcatchに投げる
            }
        }
        // --- ログイン処理 (Login) ---
        else if (action === 'login') {
            const { rows } = await client.sql `
        SELECT * FROM users WHERE username = ${username} AND password = ${password} LIMIT 1;
      `;
            if (rows.length > 0) {
                return res.status(200).json({ message: "ログインに成功しました！" });
            }
            else {
                return res.status(401).json({ error: "IDまたはパスワードが正しくありません。" });
            }
        }
    }
    catch (error) {
        console.error('Server Error:', error);
        return res.status(500).json({ error: "サーバー内部でエラーが発生しました。" });
    }
}
//# sourceMappingURL=server.js.map