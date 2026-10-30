---
title: "提交规范"
weight: 2
description: "本仓库提交标题的格式要求与示例。"
---

提交首行应满足：

```text
[类型] 摘要
```

允许的类型包括：

- `feat`
- `fix`
- `docs`
- `style`
- `refactor`
- `perf`
- `test`
- `chore`
- `ci`
- `build`
- `revert`

## 示例

- `[feat] 新增分镜批量编辑`
- `[fix] 修复模型列表分页`
- `[docs] 更新本地开发文档`

## 校验入口

标题使用小写允许类型，类型后以空格分隔非空摘要。只检查消息文件的第一行，正文不受此格式限制；默认 `Merge ...`、`Revert ...` 和解决冲突后的提交同样需要合法标题。

本地 hook 与既有 CI 共用 `scripts/check-commit-subject.mjs`，需要 Node.js（CI 使用 Node 24），无需安装 npm 依赖：

```sh
node scripts/check-commit-subject.mjs --message-file .git/COMMIT_EDITMSG
node scripts/check-commit-subject.mjs --range BASE_SHA..HEAD_SHA
node --test scripts/check-commit-subject.test.mjs
```

范围入口检查全部可达待检提交，包括合并提交。非法引用或范围返回非零退出码；合法空范围明确输出 `No commits to check.`。标题失败显示提交哈希（消息文件模式显示路径）、原首行和原因。

Git 自动回滚不调用 `commit-msg`，因此 `prepare-commit-msg` 也将已有消息转交同一校验器。回滚时可先准备变更，再使用合法标题提交：

```sh
git revert --no-commit COMMIT_SHA
git commit -m "[revert] 回滚原因"
```

默认合并标题被拒绝后，可使用 `git commit -m "[chore] 合并说明"` 完成；也可以在合并命令中直接提供合法 `-m` 标题。hook 文件存在不代表当前仓库已经启用，CI 直接调用范围入口，不依赖本地 hook 安装状态。
