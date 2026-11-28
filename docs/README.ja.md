# Jellyfish — AI ショートドラマ制作スタジオ

<p align="center">
  <img src="img/logo.svg" alt="Jellyfish Logo" width="160" />
</p>

<p align="center">
  <a href="https://www.apache.org/licenses/LICENSE-2.0">
    <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License" />
  </a>
  <a href="https://img.shields.io/badge/frontend-React%20%2B%20Vite-61DAFB">
    <img src="https://img.shields.io/badge/frontend-React%20%2B%20Vite-61DAFB" alt="Frontend" />
  </a>
  <a href="https://img.shields.io/badge/backend-FastAPI-009688">
    <img src="https://img.shields.io/badge/backend-FastAPI-009688" alt="Backend" />
  </a>
  <a href="https://github.com/Forget-C/Jellyfish/actions/workflows/deploy-site.yml">
    <img src="https://github.com/Forget-C/Jellyfish/actions/workflows/deploy-site.yml/badge.svg" alt="Deploy Site" />
  </a>
  <a href="https://github.com/Forget-C/Jellyfish/actions/workflows/ghcr-images.yml">
    <img src="https://github.com/Forget-C/Jellyfish/actions/workflows/ghcr-images.yml/badge.svg" alt="Build and push images" />
  </a>
</p>

<p align="center">
  <a href="README.en.md">English</a> ·
  <a href="README.zh.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a>
</p>

AI ショートドラマの制作ワークスペースです。章の本文をシーンに分け、参考素材をそろえ、絵コンテのキャンバスで候補画像を生成します。画面の表示言語は中国語（初期設定）と英語です。

[クイックスタート](#クイックスタート) · [ローカル開発](development/guides/local-development.md)

## Jellyfish とは？

<p align="center">
  <a href="../site/static/images/sea-letter/canvas-walkthrough.mp4"><img src="img/canvas-walkthrough.gif" width="960" alt="絵コンテ上でカットの説明を確認し、ホームで手紙を読む林夏のフレームをプレビューする様子" /></a>
</p>

Jellyfish はショートドラマの脚本を絵コンテにする制作ツールです。章をシーンに分け、それぞれに人物や場所、小道具の参考画像を選び、絵コンテ上でフレームを生成して見比べられます。デモでは、カットの説明と参考画像をもとに、ホームで手紙を読む林夏の姿を描いています。

## 主な機能

| 章の本文から絵コンテを生成 | 同じ会話で画像と動画を生成 |
| --- | --- |
| <a href="../site/static/images/screenshots/home/scene-division.webp"><img src="../site/static/images/screenshots/home/scene-division.webp" width="195" alt="章の本文から絵コンテを生成" /></a> <a href="../site/static/images/screenshots/home/storyboard.webp"><img src="../site/static/images/screenshots/home/storyboard.webp" width="195" alt="絵コンテ" /></a> | <a href="img/chat-image-to-video.webp"><img src="img/chat-image-to-video.webp" width="420" alt="同じ会話で画像と動画を生成" /></a> |
| 章をシーンに分け、対応する本文を確認してから、シーンごとに編集可能な絵コンテを生成します。 | 会話はメインモデルが担当し、画像と動画はそれぞれ選択したモデルが生成します。前のターンの画像を動画の最初のフレームに使えます。 |

| キャンバス編集 | キャンバスアシスタント |
| --- | --- |
| <a href="../site/static/images/docs/canvas/graph.webp"><img src="../site/static/images/docs/canvas/graph.webp" width="420" alt="キャンバス編集" /></a> | <a href="img/canvas-assistant-proposal.webp"><img src="img/canvas-assistant-proposal.webp" width="420" alt="キャンバスアシスタント" /></a> |
| カットの説明、参考画像、モデルカードをつなぎ、入力を調整して実行し、候補画像を見比べられます。 | カットのカードを選び、変更したい内容を伝えると、アシスタントの修正案を確認して適用できます。 |

| プロジェクト管理 | 共有素材ライブラリ |
| --- | --- |
| <a href="../site/static/images/docs/chapter/chapter.webp"><img src="../site/static/images/docs/chapter/chapter.webp" width="420" alt="プロジェクト管理" /></a> | <a href="../site/static/images/screenshots/assets.png"><img src="../site/static/images/screenshots/assets.png" width="420" alt="共有素材ライブラリ" /></a> |
| プロジェクトごとに章とシーンを整理し、章から絵コンテの作業画面を開けます。 | 俳優、場所、小道具、衣装の素材を複数のプロジェクトで再利用できます。 |

### MCP でキャンバスに接続

外部の MCP クライアントからキャンバスを読み取り、編集・実行して生成結果を取得できます。 [接続ガイド](../site/content/docs/tools/generation-canvas.md#从-mcp-客户端连接画布)

## クイックスタート

初めてローカル環境で試す場合は、Git をインストールし、Compose プラグインを備えた Docker を起動してから、次のコマンドを実行します。

```bash
git clone https://github.com/Forget-C/Jellyfish.git
cd Jellyfish
cp deploy/compose/.env.example deploy/compose/.env
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml up --build -d
```

[Jellyfish](http://localhost:7788) を開き、プロジェクト一覧から[最初のプロジェクトを作成](../site/content/docs/guide/first-project.md)します。画像や動画を生成する前に[モデルを設定](../site/content/docs/getting-started/model-setup.md)してください。

[デプロイガイド](../site/content/docs/getting-started/docker.md) · [キャンバス MCP](../site/content/docs/tools/generation-canvas.md#从-mcp-客户端连接画布) · [OpenAPI クライアント](development/guides/openapi.md)

## Star History

[![Jellyfish の GitHub スター数の推移](https://api.star-history.com/svg?repos=Forget-C%2FJellyfish&type=Date)](https://www.star-history.com/?repos=Forget-C%2FJellyfish&type=date)

[問題を報告](https://github.com/Forget-C/Jellyfish/issues) · [開発に参加](../site/content/docs/community/contributing.md) · [Apache 2.0 ライセンス](../LICENSE)
