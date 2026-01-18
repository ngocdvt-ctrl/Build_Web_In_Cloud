# Building_Web_In_Cloud
ngoc-web – ProductionレベルのフルスタックWebアプリ

ngoc-web は、デモ用途ではなく実運用（production）を前提に設計・開発したフルスタックWebアプリケーションです。<br>
バックエンド・フロントエンド・セキュリティ・クラウドの理解力を総合的に示すことを目的としています。<br>

**🔧 技術スタック**<br>
Frontend: HTML / CSS / Vanilla JavaScript<br>
Backend: Node.js（Vercel Serverless Functions）<br>
Database: PostgreSQL（Neon）<br>
認証: セッション方式（HTTP-only Cookie）<br>
Storage: Google Cloud Storage（Private + Signed URL v4）<br>
Deploy: Vercel<br>

**🔐 主な機能**<br>
ユーザー登録＋メール認証<br>
セキュアなログイン／ログアウト（bcrypt＋DBセッション）<br>
ロールベース認可（user / admin）<br>
Last Admin Guard を含む管理者フロー（production設計）<br>
ユーザー情報CRUD（CRU実装済み）<br>
ログイン必須のファイルダウンロード（Signed URL・非公開）<br>

**⭐ アピールポイント**<br>
Tokenではなく実運用向けセッション認証<br>
セキュリティ・クラウドストレージ・REST API・DB設計を理解<br>
Race condition を考慮した実装<br>

実際に本番環境で動作可能（デモ可）
