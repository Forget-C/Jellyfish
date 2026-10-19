---
title: "Agent 分诊状态"
description: "本地任务票据使用的五个默认分诊状态。"
---

# Triage labels

普通实现票据顶部的 `Status:` 使用下表取值。技能提及某个分诊角色时，使用对应状态。

| 技能角色 | 本地状态 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 等待维护者评估 |
| `needs-info` | `needs-info` | 等待补充信息 |
| `ready-for-agent` | `ready-for-agent` | 需求明确，可由 Agent 实现 |
| `ready-for-human` | `ready-for-human` | 需要人工实现 |
| `wontfix` | `wontfix` | 决定不处理 |

每张普通实现票据同时保留一个分诊状态。`/wayfinder` 决策票据的领取和解决状态按 `issue-tracker.md` 中的专属约定记录。
