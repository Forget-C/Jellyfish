# 提交规范

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

## 显式安装与只读自检

从仓库根目录运行：

```sh
node scripts/repository-hooks.mjs check
node scripts/repository-hooks.mjs install
node scripts/repository-hooks.mjs check
```

`check` 只读核对当前检出的有效 `core.hooksPath`、两个 hook 文件的存在与可执行权限，以及共享校验器的存在与可读权限；未启用、配置冲突或文件问题均返回非零退出码，并给出修复入口。输出实际 Git 目录与共用 Git 目录，便于核对 worktree。它不会自动安装、复制或修改权限。

`install` 显式将仓库共用的本地配置设为 `core.hooksPath=.githooks`。相对路径在各检出根目录解析，主检出与关联 worktree 各自使用所检出版本的 hook 和校验器。安装前会检查所有已登记、非 bare 的检出，缺文件或不可执行时先修复这些检出；重复安装安全。存在独立 worktree 配置时，同样检查其覆盖值。

已有自定义 `hooksPath` 默认保留并报错；确认放弃当前仓库及关联 worktree 的自定义路径后，才显式选择替换：

```sh
node scripts/repository-hooks.mjs install --replace-custom-hooks-path
```

替换仅写当前仓库的共用本地配置及已有的 worktree 覆盖配置，不改全局配置、Git 身份或签名设置，也不删除自定义 hook 文件。全局自定义路径仍保留，但会被当前仓库的本地设置覆盖。

在仓库子目录可通过脚本的相对或绝对路径调用；从仓库外运行时，使用脚本绝对路径和 `--repo` 指定检出目录（主检出或关联 worktree 均可）：

```sh
node /path/to/jellyfish/scripts/repository-hooks.mjs check --repo /path/to/jellyfish
node /path/to/jellyfish/scripts/repository-hooks.mjs install --repo /path/to/jellyfish
node --test scripts/check-commit-subject.test.mjs scripts/repository-hooks.test.mjs
```

依赖安装、业务启动和普通预检不会调用安装入口。实际开发仓库安装是单独的显式操作；CI 运行临时 Git 验证并直接使用共享标题校验器，不要求在 runner 中安装 hook。
