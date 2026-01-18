# Building_Web_In_Cloud
ngoc-web – ProductionレベルのフルスタックWebアプリ

ngoc-web は、デモ用途ではなく実運用（production）を前提に設計・開発した<br>
フルスタックWebアプリケーションです。
バックエンド・フロントエンド・セキュリティ・クラウドの理解力を総合的に示すことを目的としています。

**🔧 技術スタック**
Frontend: HTML / CSS / Vanilla JavaScript
Backend: Node.js（Vercel Serverless Functions）
Database: PostgreSQL（Neon）
認証: セッション方式（HTTP-only Cookie）
Storage: Google Cloud Storage（Private + Signed URL v4）
Deploy: Vercel

**🔐 主な機能**
ユーザー登録＋メール認証
セキュアなログイン／ログアウト（bcrypt＋DBセッション）
ロールベース認可（user / admin）
Last Admin Guard を含む管理者フロー（production設計）
ユーザー情報CRUD（CRU実装済み）
ログイン必須のファイルダウンロード（Signed URL・非公開）

**⭐ アピールポイント**
Tokenではなく実運用向けセッション認証
セキュリティ・クラウドストレージ・REST API・DB設計を理解
Race condition を考慮した実装

実際に本番環境で動作可能（デモ可）
