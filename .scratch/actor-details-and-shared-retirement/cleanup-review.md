# 历史共享关联清理审查

状态：只读候选盘点；不是批准删除清单。

目标：backend/.env 指向的回环 MySQL 本地开发库；2026-11-15。所有数据库操作均为 READ ONLY 事务内 SELECT，结束回滚。未执行 DDL/DML、未查询部署库；下文仅含身份和数量，不含内容、凭据。

## 影响摘要

| 类别 | 数量 | 处置边界 |
| --- | ---: | --- |
| 旧共享关联 | 3 | 场景2、道具1；涉及2个项目 |
| 图片记录 / 有效文件身份 | 4 / 2 | 其中2条图片记录无文件；不伪造文件，不要求空图资产先生成 |
| 当前场次准备 / 场次方案 / 画布 | 1 / 2 / 2 | 更新有效引用，不删除当前对象 |
| 历史任务 | 39 | 对应项目；均非queued/running；另2条其他项目或库中原件任务保留 |
| 固定修订 | 42 | 从9条内容精确命中扩展出的必要下游闭包 |
| Take / cut_frames / cut_take_references | 5 / 10 / 13 | 会影响实际历史素材和剪辑采用，需重新确认具体范围 |
| 修订依赖 / actions / repair_plans / seam_reviews | 62 / 16 / 1 / 1 | 必要外键下游候选；不是整表清理 |
| 画布运行节点 / 结果集 / 当前输出指针 | 6 / 6 / 6 | 当前输出指针与可编辑文档的恢复策略须核对 |
| 画布事件 / 保存回执 | 14 / 1 | 保证游标、重放和幂等契约，不可孤立删除 |
| 任务输入关系 | 20 | 跟随39条候选任务；不删除对应文件 |
| 全库来源文件使用关系 | 10 | 仅精确命中统计，不属于直接删除清单 |

这些数字为本地一次只读快照。执行前必须重新预检，并核对来源、主键集合及依赖变化；部署库不可套用本清单。

## 共享来源与项目范围

每项按 project_id + kind + asset_id 建一个独立副本；images 列出待复制记录及原文件，库中原件和原文件保留。

```json
{"kind": "scene", "link_id": 2, "project_id": "ddb77af6-7778-4d56-9151-f9b91be8d788", "chapter_id": "3705b37a-7c4c-4f42-a9d3-c947ba9af11d", "asset_id": "3df48dd079224d599226e57d93c6cd95", "images": [{"id": 2, "file_id": null}]}
```

```json
{"kind": "scene", "link_id": 3, "project_id": "a4ea5321-a5ff-46f9-805a-17c1ad182ae6", "chapter_id": "88fbc183-cd1d-4ed6-9926-9bfe39c154bc", "asset_id": "b0b55d53c6584682959ca8d62b9cd77f", "images": [{"id": 3, "file_id": "460f67badb9c5d1cae81b0cf546cb144"}]}
```

```json
{"kind": "prop", "link_id": 2, "project_id": "ddb77af6-7778-4d56-9151-f9b91be8d788", "chapter_id": "3705b37a-7c4c-4f42-a9d3-c947ba9af11d", "asset_id": "fb0f8b4e9f304c84946edbf28a91758c", "images": [{"id": 2, "file_id": null}, {"id": 3, "file_id": "e957b9ef23e05b6db9ed3dcc4af18947"}]}
```

## 当前可变引用（需要映射，不应整行删除）

- `directing_scene_versions`：2 行；主键：`{"id": "50e65178c63948e2be3a1d7691e5eda0"}`, `{"id": "59791d073efc4a46bc7860dc95e0b270"}`
- `directing_sequences`：1 行；主键：`{"id": "d745684b7495466cb2aaa6bdc3552aed"}`
- `generation_canvases`：2 行；主键：`{"id": "d8a7eccaeecc4a999d0b143b4650cebe"}`, `{"id": "e15c1cc01c14422f9915fd7ba79e6fe7"}`

## 历史候选及外键下游闭包

种子为对应项目 JSON 中精确命中来源资产 ID 或图片文件 ID 的历史行；闭包按实际外键传播（含 CASCADE/RESTRICT）及修订依赖索引传播。这里只计算影响，未执行删除。闭包可能触及当前指针或业务状态，不能按表名直接整表删除。

### directing_actions

精确命中种子 0 行；含依赖闭包共 16 行。

```json
[
  {
    "id": "13ec9fd7a0a84d91a2bce6fcb12ef777"
  },
  {
    "id": "14dbc794f0224709b9aa57beba593edc"
  },
  {
    "id": "1f260792d7dc4f538e7b0e0f28334f65"
  },
  {
    "id": "2b7c1a594c414ba786772c849f44d5f8"
  },
  {
    "id": "4f4359a6abf94b03a4070a016765aab1"
  },
  {
    "id": "50052eff90fa400097fe004a1b2915d6"
  },
  {
    "id": "69a0397f83b34ef5bcada946b17a69a4"
  },
  {
    "id": "6c542742b2ba4740856ff4fd7a0e3201"
  },
  {
    "id": "795a59a647a94063b6313888226063bd"
  },
  {
    "id": "89310ad0178740bbb6d0dd4a216660da"
  },
  {
    "id": "9880639471104ca49a47126d925ee397"
  },
  {
    "id": "b1177c8bd2074deebdd61e6b4f807d77"
  },
  {
    "id": "c0436c8b54e545bd833c3f3e723ca709"
  },
  {
    "id": "cb22a05fa8fd44ecb8140446727bc734"
  },
  {
    "id": "cc9b9511fb1a4afcb499c66bd79d1b32"
  },
  {
    "id": "e4d84c531d2f4728ba3ec67df5ee1048"
  }
]
```

### directing_cut_frames

精确命中种子 0 行；含依赖闭包共 10 行。

```json
[
  {
    "id": "036bdfc1adf548d79f3e99e37d6cbb92"
  },
  {
    "id": "0f35ba2abcc148998c093a9317caabd6"
  },
  {
    "id": "142cb066f6ff41e4a8df0aacfec070d2"
  },
  {
    "id": "16b3c4120b8e4a9381c7c8e93c442619"
  },
  {
    "id": "3a9e3948ebe447b6a6eed9976e301cef"
  },
  {
    "id": "3c784fab79254b1dba8122d3a5ce2399"
  },
  {
    "id": "4a783563533e48a49f0db6c6bf8737e6"
  },
  {
    "id": "742edaa5ff6f47aabb401dd72546b111"
  },
  {
    "id": "8c4ee75d2c174c1eb61a2557b450de5f"
  },
  {
    "id": "9bf2f149dacb433e91be0f1655fb547d"
  }
]
```

### directing_cut_take_references

精确命中种子 0 行；含依赖闭包共 13 行。

```json
[
  {
    "revision_id": "30dabff969a340faafdf561a52599c50",
    "take_id": "2b44f0d9d5ff48cdb3b4664a3927a8d5"
  },
  {
    "revision_id": "30dabff969a340faafdf561a52599c50",
    "take_id": "75172bf2efc844a9a79d0e61a367f49c"
  },
  {
    "revision_id": "53f1d141e53d42d9b1b0ae4200f119d3",
    "take_id": "d02824ba3be741fd87758c87d706a620"
  },
  {
    "revision_id": "88c543a211ac4290aaacc546a24b2805",
    "take_id": "2b44f0d9d5ff48cdb3b4664a3927a8d5"
  },
  {
    "revision_id": "92fb41ca9fc349b4a837939198abb4dd",
    "take_id": "d7184587ed3849718df33910bf457410"
  },
  {
    "revision_id": "c5ebf6a87f1144dcab7b7348525591da",
    "take_id": "2b44f0d9d5ff48cdb3b4664a3927a8d5"
  },
  {
    "revision_id": "ce22c026d7ac4b8fb04ed8ca42e219d1",
    "take_id": "2b44f0d9d5ff48cdb3b4664a3927a8d5"
  },
  {
    "revision_id": "d3d5d32258a6498d86d0e4e77490de42",
    "take_id": "d7184587ed3849718df33910bf457410"
  },
  {
    "revision_id": "dadc6f90092448f19b26194f3f543b7c",
    "take_id": "2b44f0d9d5ff48cdb3b4664a3927a8d5"
  },
  {
    "revision_id": "dadc6f90092448f19b26194f3f543b7c",
    "take_id": "75172bf2efc844a9a79d0e61a367f49c"
  },
  {
    "revision_id": "ddba7a799b6d47cdb035654f59334ce7",
    "take_id": "2b44f0d9d5ff48cdb3b4664a3927a8d5"
  },
  {
    "revision_id": "ddba7a799b6d47cdb035654f59334ce7",
    "take_id": "75172bf2efc844a9a79d0e61a367f49c"
  },
  {
    "revision_id": "f56f3492ab3e409c96e65eb5e5e142a7",
    "take_id": "d02824ba3be741fd87758c87d706a620"
  }
]
```

### directing_repair_plans

精确命中种子 0 行；含依赖闭包共 1 行。

```json
[
  {
    "repair_revision_id": "c5ebf6a87f1144dcab7b7348525591da",
    "plan_revision_id": "829d16a0f8354413b1f26b18f2150f4a"
  }
]
```

### directing_revision_dependencies

精确命中种子 0 行；含依赖闭包共 62 行。

```json
[
  {
    "revision_id": "01aa245283014c24bd10dd2157626af6",
    "dependency_id": "10a37ae1e4f84b46993d2862682575e2"
  },
  {
    "revision_id": "01aa245283014c24bd10dd2157626af6",
    "dependency_id": "9eadde0f7147476ebc986b00fccb0cde"
  },
  {
    "revision_id": "01aa245283014c24bd10dd2157626af6",
    "dependency_id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "revision_id": "10a37ae1e4f84b46993d2862682575e2",
    "dependency_id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "revision_id": "244f0d1e217548deb83b8f19ea96d5e9",
    "dependency_id": "834604349a20418cae4fb315c033b529"
  },
  {
    "revision_id": "244f0d1e217548deb83b8f19ea96d5e9",
    "dependency_id": "f4404c2e1b5044afb5332a120cae9d67"
  },
  {
    "revision_id": "2bee121c0a93462ea20f627be1bbba3f",
    "dependency_id": "b74b25b239004894af75b94545f8844d"
  },
  {
    "revision_id": "2bee121c0a93462ea20f627be1bbba3f",
    "dependency_id": "d097c7b0cf284391b055ccc907a54ace"
  },
  {
    "revision_id": "2df721c0fcff44029c3cca566a070817",
    "dependency_id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "revision_id": "30dabff969a340faafdf561a52599c50",
    "dependency_id": "88c543a211ac4290aaacc546a24b2805"
  },
  {
    "revision_id": "30dabff969a340faafdf561a52599c50",
    "dependency_id": "afe59fd8e29d4d58908b22128e0a1d30"
  },
  {
    "revision_id": "30dabff969a340faafdf561a52599c50",
    "dependency_id": "dadc6f90092448f19b26194f3f543b7c"
  },
  {
    "revision_id": "368878c4724644b485e4cb55b44f86f6",
    "dependency_id": "962dd1428ac84a5db7a76327c12ca20a"
  },
  {
    "revision_id": "368878c4724644b485e4cb55b44f86f6",
    "dependency_id": "afe59fd8e29d4d58908b22128e0a1d30"
  },
  {
    "revision_id": "39617f46c9ec4728a2cd8599ce0c5563",
    "dependency_id": "6e07b5df44c044738b9a5394bc3bdb8c"
  },
  {
    "revision_id": "4bda3924f1794cee9e12931eb9ffa10f",
    "dependency_id": "2bee121c0a93462ea20f627be1bbba3f"
  },
  {
    "revision_id": "4bda3924f1794cee9e12931eb9ffa10f",
    "dependency_id": "d097c7b0cf284391b055ccc907a54ace"
  },
  {
    "revision_id": "606318eb5ecd4543a8ec4e7d1c577863",
    "dependency_id": "10a37ae1e4f84b46993d2862682575e2"
  },
  {
    "revision_id": "606318eb5ecd4543a8ec4e7d1c577863",
    "dependency_id": "9eadde0f7147476ebc986b00fccb0cde"
  },
  {
    "revision_id": "606318eb5ecd4543a8ec4e7d1c577863",
    "dependency_id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "revision_id": "672928a6fa984321a54cacaadf5961cb",
    "dependency_id": "39617f46c9ec4728a2cd8599ce0c5563"
  },
  {
    "revision_id": "672928a6fa984321a54cacaadf5961cb",
    "dependency_id": "a75c2025e3a34b0a847e060d43aec673"
  },
  {
    "revision_id": "79c928a2967c4ea78126f2311f754ff9",
    "dependency_id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "revision_id": "7b105a71b44c41d1a553ac78514dd1cf",
    "dependency_id": "2df721c0fcff44029c3cca566a070817"
  },
  {
    "revision_id": "7b105a71b44c41d1a553ac78514dd1cf",
    "dependency_id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "revision_id": "7b61eef318a641278234f3b6e0577921",
    "dependency_id": "10a37ae1e4f84b46993d2862682575e2"
  },
  {
    "revision_id": "7b61eef318a641278234f3b6e0577921",
    "dependency_id": "9eadde0f7147476ebc986b00fccb0cde"
  },
  {
    "revision_id": "7b61eef318a641278234f3b6e0577921",
    "dependency_id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "revision_id": "80ad1517b46a4a3bbf4c6300b0f335ff",
    "dependency_id": "829d16a0f8354413b1f26b18f2150f4a"
  },
  {
    "revision_id": "80ad1517b46a4a3bbf4c6300b0f335ff",
    "dependency_id": "d604636a021a43d5b69c0629fdcf19c6"
  },
  {
    "revision_id": "829d16a0f8354413b1f26b18f2150f4a",
    "dependency_id": "0003414f4a6f4263b8a2c4be603bfa89"
  },
  {
    "revision_id": "834604349a20418cae4fb315c033b529",
    "dependency_id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "revision_id": "834604349a20418cae4fb315c033b529",
    "dependency_id": "f4404c2e1b5044afb5332a120cae9d67"
  },
  {
    "revision_id": "9795ef8f92a94081b6b4a06a0c71807e",
    "dependency_id": "db6f8bf890744dd1a7c43eeff250f85c"
  },
  {
    "revision_id": "9795ef8f92a94081b6b4a06a0c71807e",
    "dependency_id": "fdb60e65a39b4c20b81d99075c8858c6"
  },
  {
    "revision_id": "9eadde0f7147476ebc986b00fccb0cde",
    "dependency_id": "10a37ae1e4f84b46993d2862682575e2"
  },
  {
    "revision_id": "9eadde0f7147476ebc986b00fccb0cde",
    "dependency_id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "revision_id": "a75c2025e3a34b0a847e060d43aec673",
    "dependency_id": "39617f46c9ec4728a2cd8599ce0c5563"
  },
  {
    "revision_id": "a75c2025e3a34b0a847e060d43aec673",
    "dependency_id": "6e07b5df44c044738b9a5394bc3bdb8c"
  },
  {
    "revision_id": "afe59fd8e29d4d58908b22128e0a1d30",
    "dependency_id": "962dd1428ac84a5db7a76327c12ca20a"
  },
  {
    "revision_id": "c36c3d9acea540c59de6df3bf38e5e71",
    "dependency_id": "0003414f4a6f4263b8a2c4be603bfa89"
  },
  {
    "revision_id": "ce09c3de1e834e57b1cab837b2401254",
    "dependency_id": "0003414f4a6f4263b8a2c4be603bfa89"
  },
  {
    "revision_id": "ce09c3de1e834e57b1cab837b2401254",
    "dependency_id": "c36c3d9acea540c59de6df3bf38e5e71"
  },
  {
    "revision_id": "d097c7b0cf284391b055ccc907a54ace",
    "dependency_id": "b74b25b239004894af75b94545f8844d"
  },
  {
    "revision_id": "d31be126f4dd4f3ca4d23a0ade1a1f10",
    "dependency_id": "79c928a2967c4ea78126f2311f754ff9"
  },
  {
    "revision_id": "d31be126f4dd4f3ca4d23a0ade1a1f10",
    "dependency_id": "ddb39e13963e49e1ba94f19b586a8c4d"
  },
  {
    "revision_id": "d31be126f4dd4f3ca4d23a0ade1a1f10",
    "dependency_id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "revision_id": "d604636a021a43d5b69c0629fdcf19c6",
    "dependency_id": "0003414f4a6f4263b8a2c4be603bfa89"
  },
  {
    "revision_id": "d604636a021a43d5b69c0629fdcf19c6",
    "dependency_id": "829d16a0f8354413b1f26b18f2150f4a"
  },
  {
    "revision_id": "ddb39e13963e49e1ba94f19b586a8c4d",
    "dependency_id": "79c928a2967c4ea78126f2311f754ff9"
  },
  {
    "revision_id": "ddb39e13963e49e1ba94f19b586a8c4d",
    "dependency_id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "revision_id": "ed728b75a5ef483384c9468510ce7344",
    "dependency_id": "c36c3d9acea540c59de6df3bf38e5e71"
  },
  {
    "revision_id": "ed728b75a5ef483384c9468510ce7344",
    "dependency_id": "ce09c3de1e834e57b1cab837b2401254"
  },
  {
    "revision_id": "f4404c2e1b5044afb5332a120cae9d67",
    "dependency_id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "revision_id": "f680eae032184aebb4129dec7cd1dfd5",
    "dependency_id": "834604349a20418cae4fb315c033b529"
  },
  {
    "revision_id": "f680eae032184aebb4129dec7cd1dfd5",
    "dependency_id": "f4404c2e1b5044afb5332a120cae9d67"
  },
  {
    "revision_id": "f787577f2f4541a8bd0350b6bbcb788e",
    "dependency_id": "54f6dc346a194ea1ae36bbd874ffe8d3"
  },
  {
    "revision_id": "f9974a16e934470db0c020d9be3b45ca",
    "dependency_id": "368878c4724644b485e4cb55b44f86f6"
  },
  {
    "revision_id": "f9974a16e934470db0c020d9be3b45ca",
    "dependency_id": "afe59fd8e29d4d58908b22128e0a1d30"
  },
  {
    "revision_id": "fa011b93e8d54ca3a80b5b07d3aee866",
    "dependency_id": "54f6dc346a194ea1ae36bbd874ffe8d3"
  },
  {
    "revision_id": "fa011b93e8d54ca3a80b5b07d3aee866",
    "dependency_id": "f787577f2f4541a8bd0350b6bbcb788e"
  },
  {
    "revision_id": "fdb60e65a39b4c20b81d99075c8858c6",
    "dependency_id": "db6f8bf890744dd1a7c43eeff250f85c"
  }
]
```

### directing_revisions

精确命中种子 9 行；含依赖闭包共 42 行。

```json
[
  {
    "id": "0003414f4a6f4263b8a2c4be603bfa89"
  },
  {
    "id": "01aa245283014c24bd10dd2157626af6"
  },
  {
    "id": "10a37ae1e4f84b46993d2862682575e2"
  },
  {
    "id": "1eb46889d62e4cd2ac7da6d20cff210f"
  },
  {
    "id": "244f0d1e217548deb83b8f19ea96d5e9"
  },
  {
    "id": "2bee121c0a93462ea20f627be1bbba3f"
  },
  {
    "id": "2df721c0fcff44029c3cca566a070817"
  },
  {
    "id": "30dabff969a340faafdf561a52599c50"
  },
  {
    "id": "368878c4724644b485e4cb55b44f86f6"
  },
  {
    "id": "39617f46c9ec4728a2cd8599ce0c5563"
  },
  {
    "id": "4bda3924f1794cee9e12931eb9ffa10f"
  },
  {
    "id": "54f6dc346a194ea1ae36bbd874ffe8d3"
  },
  {
    "id": "606318eb5ecd4543a8ec4e7d1c577863"
  },
  {
    "id": "672928a6fa984321a54cacaadf5961cb"
  },
  {
    "id": "6e07b5df44c044738b9a5394bc3bdb8c"
  },
  {
    "id": "79c928a2967c4ea78126f2311f754ff9"
  },
  {
    "id": "7b105a71b44c41d1a553ac78514dd1cf"
  },
  {
    "id": "7b61eef318a641278234f3b6e0577921"
  },
  {
    "id": "80ad1517b46a4a3bbf4c6300b0f335ff"
  },
  {
    "id": "829d16a0f8354413b1f26b18f2150f4a"
  },
  {
    "id": "834604349a20418cae4fb315c033b529"
  },
  {
    "id": "962dd1428ac84a5db7a76327c12ca20a"
  },
  {
    "id": "9795ef8f92a94081b6b4a06a0c71807e"
  },
  {
    "id": "9eadde0f7147476ebc986b00fccb0cde"
  },
  {
    "id": "a75c2025e3a34b0a847e060d43aec673"
  },
  {
    "id": "afe59fd8e29d4d58908b22128e0a1d30"
  },
  {
    "id": "b74b25b239004894af75b94545f8844d"
  },
  {
    "id": "c36c3d9acea540c59de6df3bf38e5e71"
  },
  {
    "id": "ce09c3de1e834e57b1cab837b2401254"
  },
  {
    "id": "d097c7b0cf284391b055ccc907a54ace"
  },
  {
    "id": "d31be126f4dd4f3ca4d23a0ade1a1f10"
  },
  {
    "id": "d604636a021a43d5b69c0629fdcf19c6"
  },
  {
    "id": "db6f8bf890744dd1a7c43eeff250f85c"
  },
  {
    "id": "ddb39e13963e49e1ba94f19b586a8c4d"
  },
  {
    "id": "de772f42c994461a9db9d9a13945f82a"
  },
  {
    "id": "ed728b75a5ef483384c9468510ce7344"
  },
  {
    "id": "f4404c2e1b5044afb5332a120cae9d67"
  },
  {
    "id": "f680eae032184aebb4129dec7cd1dfd5"
  },
  {
    "id": "f787577f2f4541a8bd0350b6bbcb788e"
  },
  {
    "id": "f9974a16e934470db0c020d9be3b45ca"
  },
  {
    "id": "fa011b93e8d54ca3a80b5b07d3aee866"
  },
  {
    "id": "fdb60e65a39b4c20b81d99075c8858c6"
  }
]
```

### directing_seam_reviews

精确命中种子 0 行；含依赖闭包共 1 行。

```json
[
  {
    "id": "367e8eb0f25f4d818fb09edc6b67f025"
  }
]
```

### directing_takes

精确命中种子 0 行；含依赖闭包共 5 行。

```json
[
  {
    "id": "2b44f0d9d5ff48cdb3b4664a3927a8d5"
  },
  {
    "id": "75172bf2efc844a9a79d0e61a367f49c"
  },
  {
    "id": "be64ce54392e4f6a995981b6b35ddd0d"
  },
  {
    "id": "d02824ba3be741fd87758c87d706a620"
  },
  {
    "id": "d7184587ed3849718df33910bf457410"
  }
]
```

### generation_canvas_current_outputs

精确命中种子 0 行；含依赖闭包共 6 行。

```json
[
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "card_id": "b973070cd6d358e586992a5ed0d4776e"
  },
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "card_id": "c1c6829ef7ad5bb0929ed834d1063aad"
  },
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "card_id": "e06a5c467585545c8e20be4a658476b4"
  },
  {
    "canvas_id": "e15c1cc01c14422f9915fd7ba79e6fe7",
    "card_id": "1fbf3c04-4b2e-4394-bc61-90c761fbd942"
  },
  {
    "canvas_id": "e15c1cc01c14422f9915fd7ba79e6fe7",
    "card_id": "7ffa8267-2ca3-4aba-897c-052dd581aeb1"
  },
  {
    "canvas_id": "e15c1cc01c14422f9915fd7ba79e6fe7",
    "card_id": "e971bfbb-e0ee-46b3-a017-b2f445e86b3c"
  }
]
```

### generation_canvas_events

精确命中种子 14 行；含依赖闭包共 14 行。

```json
[
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "cursor": 1
  },
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "cursor": 11
  },
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "cursor": 2
  },
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "cursor": 3
  },
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "cursor": 5
  },
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "cursor": 6
  },
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "cursor": 7
  },
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "cursor": 8
  },
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "cursor": 9
  },
  {
    "canvas_id": "e15c1cc01c14422f9915fd7ba79e6fe7",
    "cursor": 21
  },
  {
    "canvas_id": "e15c1cc01c14422f9915fd7ba79e6fe7",
    "cursor": 22
  },
  {
    "canvas_id": "e15c1cc01c14422f9915fd7ba79e6fe7",
    "cursor": 23
  },
  {
    "canvas_id": "e15c1cc01c14422f9915fd7ba79e6fe7",
    "cursor": 39
  },
  {
    "canvas_id": "e15c1cc01c14422f9915fd7ba79e6fe7",
    "cursor": 55
  }
]
```

### generation_canvas_result_sets

精确命中种子 4 行；含依赖闭包共 6 行。

```json
[
  {
    "id": "0b9a82a14c9449f4a5ea74621f086746"
  },
  {
    "id": "3f37df5c8e96431aa43ef9e64b31c6ab"
  },
  {
    "id": "783d38349bde44b282b1b28e668edd85"
  },
  {
    "id": "afe27011a7164418954ce1df10d69f4d"
  },
  {
    "id": "b1a2905fe50e4ff7ac64f459af4d54fb"
  },
  {
    "id": "cf467e28c39e4e9fa5aba0b8cc895a9d"
  }
]
```

### generation_canvas_run_nodes

精确命中种子 6 行；含依赖闭包共 6 行。

```json
[
  {
    "id": "0a0971e861554eee96682cb51cda0a9a"
  },
  {
    "id": "3ea970938a674b9fbca12bbc7004cbc2"
  },
  {
    "id": "633e8a7e83c8481189a2d090c357a53f"
  },
  {
    "id": "6d2d0f9a290c45f2a5d27e052b6b1110"
  },
  {
    "id": "7e9d9e0c62ab4933a644d0bb01a69a7c"
  },
  {
    "id": "c7b0c9e279e1412186fe87a17aac2e44"
  }
]
```

### generation_canvas_save_receipts

精确命中种子 1 行；含依赖闭包共 1 行。

```json
[
  {
    "canvas_id": "d8a7eccaeecc4a999d0b143b4650cebe",
    "request_id": "storyboard:a11c5928474342ed86ed78894307b984"
  }
]
```

### task_inputs

精确命中种子 0 行；含依赖闭包共 20 行。

```json
[
  {
    "task_id": "0f54bed411574b4f9e348888e1a4adce",
    "role_path": "prepared-reference",
    "ordinal": 0
  },
  {
    "task_id": "0f54bed411574b4f9e348888e1a4adce",
    "role_path": "prepared-reference",
    "ordinal": 1
  },
  {
    "task_id": "35ca8971fd664010bcbb6c0b39404ffd",
    "role_path": "prepared-reference",
    "ordinal": 0
  },
  {
    "task_id": "35ca8971fd664010bcbb6c0b39404ffd",
    "role_path": "prepared-reference",
    "ordinal": 1
  },
  {
    "task_id": "5faf339286214750a5089668c1a7a1b1",
    "role_path": "prepared-reference",
    "ordinal": 0
  },
  {
    "task_id": "5faf339286214750a5089668c1a7a1b1",
    "role_path": "prepared-reference",
    "ordinal": 1
  },
  {
    "task_id": "782abc437eb2476199bc4465e3bc788c",
    "role_path": "prepared-reference",
    "ordinal": 0
  },
  {
    "task_id": "782abc437eb2476199bc4465e3bc788c",
    "role_path": "prepared-reference",
    "ordinal": 1
  },
  {
    "task_id": "8bc516cabf51413f9bdaab559740fa9a",
    "role_path": "prepared-reference",
    "ordinal": 0
  },
  {
    "task_id": "8bc516cabf51413f9bdaab559740fa9a",
    "role_path": "prepared-reference",
    "ordinal": 1
  },
  {
    "task_id": "9e72acb9940a43f1b09cf2f20e2a8121",
    "role_path": "prepared-reference",
    "ordinal": 0
  },
  {
    "task_id": "9e72acb9940a43f1b09cf2f20e2a8121",
    "role_path": "prepared-reference",
    "ordinal": 1
  },
  {
    "task_id": "a11c5928474342ed86ed78894307b984",
    "role_path": "prepared-reference",
    "ordinal": 0
  },
  {
    "task_id": "a11c5928474342ed86ed78894307b984",
    "role_path": "prepared-reference",
    "ordinal": 1
  },
  {
    "task_id": "a8c4350b85e74c34b3a39fb8cde8b76d",
    "role_path": "prepared-reference",
    "ordinal": 0
  },
  {
    "task_id": "a8c4350b85e74c34b3a39fb8cde8b76d",
    "role_path": "prepared-reference",
    "ordinal": 1
  },
  {
    "task_id": "ca3e8f2c89f54e9c8cc897029b61773a",
    "role_path": "prepared-reference",
    "ordinal": 0
  },
  {
    "task_id": "ca3e8f2c89f54e9c8cc897029b61773a",
    "role_path": "prepared-reference",
    "ordinal": 1
  },
  {
    "task_id": "f8d0459b8f274c6da1e34b0b5e0301d9",
    "role_path": "prepared-reference",
    "ordinal": 0
  },
  {
    "task_id": "f8d0459b8f274c6da1e34b0b5e0301d9",
    "role_path": "prepared-reference",
    "ordinal": 1
  }
]
```

### tasks

精确命中种子 39 行；含依赖闭包共 39 行。

```json
[
  {
    "id": "0f54bed411574b4f9e348888e1a4adce"
  },
  {
    "id": "1f19b4fe3fa9408a9ec8795f80e8c346"
  },
  {
    "id": "2a82cde20f73495a8ef4e231921a32eb"
  },
  {
    "id": "31bff66f2f38457387355d1f3fc6efea"
  },
  {
    "id": "31e96fc4c1c941289b22674df70a6445"
  },
  {
    "id": "35ca8971fd664010bcbb6c0b39404ffd"
  },
  {
    "id": "3c99cd8519884acfa8f54ca8a7eb6908"
  },
  {
    "id": "3e595b54294d4eb59624e8bf7720cdc0"
  },
  {
    "id": "41578e2ad48c41f0832bfb57eb053174"
  },
  {
    "id": "472e6d2fb4814c13bb05cb001528d312"
  },
  {
    "id": "4a6a6b5dea974934935b385e9cef55e9"
  },
  {
    "id": "4e0fcbf0418142aca25662d1a5421199"
  },
  {
    "id": "50e0d057e17245e499058f0d64f59d09"
  },
  {
    "id": "5909f6b5b0274459b6513e4f6ebef00b"
  },
  {
    "id": "5faf339286214750a5089668c1a7a1b1"
  },
  {
    "id": "6783e4aa2b8744e6a8e4a176de093da5"
  },
  {
    "id": "6a80b598eab44461b0638029fd50f3ce"
  },
  {
    "id": "7254ed16b1a747cdbdac0090d70016dc"
  },
  {
    "id": "756008561bfa49d382ea2a78e902f807"
  },
  {
    "id": "75b599a486ad44b4a3f7e26336503725"
  },
  {
    "id": "782abc437eb2476199bc4465e3bc788c"
  },
  {
    "id": "8bc516cabf51413f9bdaab559740fa9a"
  },
  {
    "id": "946575dcb4b0461fa685fbb85a9f5ffe"
  },
  {
    "id": "9e72acb9940a43f1b09cf2f20e2a8121"
  },
  {
    "id": "9f7dfb241e394cb6944a920eb4640e1a"
  },
  {
    "id": "a11c5928474342ed86ed78894307b984"
  },
  {
    "id": "a8c4350b85e74c34b3a39fb8cde8b76d"
  },
  {
    "id": "ab3a1d8b4fcf44ef9c571e9d547d3c28"
  },
  {
    "id": "ba9a4bef3d9a47818322a34d425e6781"
  },
  {
    "id": "bd9d346afe534220a95a7b688ad3f698"
  },
  {
    "id": "ca3e8f2c89f54e9c8cc897029b61773a"
  },
  {
    "id": "cfff51ff95cf40e09089c134116b67eb"
  },
  {
    "id": "d04c7627ec454a67b0dccef2fc050384"
  },
  {
    "id": "d33d14e3b72048c2bfb53c6f1e1bcd65"
  },
  {
    "id": "e5887527bb214f899ecac7af0117cb1d"
  },
  {
    "id": "e8ed7c2a3bc44ecd84164f649702d38d"
  },
  {
    "id": "ea302b26077847c1a1c5b7324481b80d"
  },
  {
    "id": "eb307487237c461cbbd2b80130d8da2d"
  },
  {
    "id": "f8d0459b8f274c6da1e34b0b5e0301d9"
  }
]
```

## 保留与未决项

- 按来源文件全库匹配会命中其他项目或库中原件的生成历史，必须保留。仅匹配 file_id 不能决定删除；以项目和有类型的来源身份限定。
- 当前可变 JSON 的映射须成组更新 source_kind/source_id/source_image_id/file_id 及对应 FileUsage，不进行全库字符串替换。
- 原文件仍供库中资产及其他有效内容使用；本次不物理删除文件或对象存储字节。新副本另建独立文件。
- 闭包只覆盖实际外键和修订依赖索引，尚需逐契约核查 JSON 中的 Take、revision、task、result_set、run_node 引用及当前指针；未决引用出现时预检拒绝执行，不能静默丢弃。
- 画布事件/保存回执会影响游标、幂等重放及文档重建，需一并设计重置规则，不能只删命中事件行。
- generation_canvas_sound_metadata_backup 属历史备份表；不作为运行态直接删除。需确认是否为有效回退资料。
- 需要按查询结果排除未完成运行；不能删除 active 运行留下占用。
- 数据清理范围与关键风险已比最初的“3 条共享关系”具体化，按 AGENTS.md 在向用户展示清单并重新确认前不得执行依赖该确认的数据变更。

### 因项目不匹配或备份身份而保留的精确匹配

- `generation_canvas_sound_metadata_backup`：1 行；主键：`{"canvas_id": "e15c1cc01c14422f9915fd7ba79e6fe7"}`
- `tasks`：2 行；主键：`{"id": "d54e7f5bb68c493e8b258612e687b1c1"}`, `{"id": "ec1b66256a4d4c0b9a9e5c424b773164"}`
