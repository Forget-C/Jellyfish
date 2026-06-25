# Jellyfish — AI短編ドラマ制作スタジオ

<p align="center">
  <img src="./img/logo.svg" alt="Jellyfish Logo" width="160" />
</p>

<p align="center">
  <a href="./README.en.md">English</a> ·
  <a href="./README.zh.md">简体中文</a> ·
  <a href="./README.ja.md">日本語</a>
</p>

AI生成の短編ドラマ制作を一気通貫で支えるワークスペースです。  
脚本入力から、分鏡、アセット整合性管理、生成実行、書き出しまでをつなぎます。

## 📷 スクリーンショット

| プロジェクト概要 | アセット管理 |
| --- | --- |
| <img src="./img/project.png" alt="Project overview" width="420" /> | <img src="./img/%E8%B5%84%E4%BA%A7%E7%AE%A1%E7%90%86.png" alt="Asset management" width="420" /> |

## ✨ コアバリュー

- **制作フローを一本化**：脚本入力から分鏡準備、画像・動画生成、タスク追跡までを一つの流れで扱えます
- **AI出力を再利用可能な制作資産に変換**：ショット、候補アセット、台詞、プロンプト、生成タスクとして蓄積できます
- **整合性を最重要課題として扱う**：キャラクター、シーン、小道具、衣装を統合管理し、ショット間のブレを抑えます
- **長時間ジョブを追跡可能なタスクとして扱う**：テキスト、画像、動画の非同期処理を統一的に可視化・中断・再開できます

## ✨ 主な機能

### 1. AI脚本理解と分鏡分解

- 章の脚本をショット単位に分解
- キャラクター、シーン、小道具、衣装、台詞の抽出
- 脚本の最適化、簡略化、一貫性チェック
- キャラクター像やシーン情報などの補助分析

### 2. 分鏡準備ワークフロー

標準フロー：

`脚本分解 → 分鏡準備 → 候補確認 → ショット ready → 生成ワークスペース`

準備段階では次を扱えます：

- ショット候補の抽出と再取得
- アセット候補の採用 / 無視
- 台詞候補の採用 / 無視
- 既存キャラクター / シーン / 小道具 / 衣装との関連付け
- ショット基本情報の修正
- 準備状態による ready 判定

### 3. アセット整合性と再利用

以下のエンティティを統一管理します：

- キャラクター / 俳優
- シーン
- 小道具
- 衣装

これによりショット間での再利用とスタイル安定化を支えます。

### 4. ショット単位の画像・動画生成

ショットが `ready` になると、生成ワークスペースで次を行えます：

- キーフレームと参照画像の管理
- 動画プロンプトのプレビュー
- 画像 / 動画生成タスクの起動
- 単ショット / バッチの生成前チェック
- 生成結果のショット・素材体系への反映

### 5. 統一タスクセンター

- 実行中および最近完了したタスクの一覧
- ステータス、進捗、経過時間、結果の追跡
- タスク取消
- 関連プロジェクト / 章 / ショットへのジャンプ

## 🔁 OpenAPI クライアント生成

フロントエンドの API クライアントと型は、バックエンドの
OpenAPI 仕様から生成されます。

```bash
cd front
pnpm run openapi:update
```

## 🐳 Docker Compose

```bash
cp deploy/compose/.env.example deploy/compose/.env
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml up --build
```

## 🧑‍💻 ローカル開発

### Backend

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd front
pnpm install
pnpm dev
```

## 📄 License

This project is licensed under [Apache-2.0](../LICENSE).
