# Data Model: 章节视频剪辑与时间线导出

**Workspace**: `video-timeline-editor` | **Date**: 2026-05-06

---

## Entities

### 章节时间线版本（表名: `chapter_timeline_states`）

**描述**: 每章节至多一条状态行，用于保存「保存时间」与（可选）乐观锁版本，支撑「后写覆盖」提示与 P2 冲突检测。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| chapter_id | VARCHAR(64) | PK, FK → chapters.id | 章节 ID |
| updated_at | DATETIME(6) | NOT NULL | 最近保存时间（UTC） |
| layout_version | INT | NOT NULL, DEFAULT 1 | 每次成功保存 +1，供 If-Match 式校验（可选实现） |

**索引**: 主键即索引。

**说明**: 若希望极简 MVP，可 **省略本表**，仅用片段表 `MAX(updated_at)` 或应用层不展示版本；本数据模型推荐保留 `layout_version` 以便与 spec 并发策略对齐。

---

### 章节时间线片段（表名: `chapter_timeline_segments`）

**描述**: 一条记录表示时间线上的一格，**逻辑绑定镜头**；成片文件在导出时从 `Shot.generated_video_file_id` 解析，避免与镜头成片脱节。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | VARCHAR(64) | PK | 片段行 ID（UUID） |
| chapter_id | VARCHAR(64) | NOT NULL, INDEX, FK | 所属章节 |
| shot_id | VARCHAR(64) | NOT NULL, INDEX, FK | 对应镜头 |
| position | INT | NOT NULL | 从 0 起的播放顺序 |
| trim_start_ms | INT | NULL | P2：入点，毫秒，空表示从头 |
| trim_end_ms | INT | NULL | P2：出点，毫秒，空表示到尾 |
| created_at | DATETIME(6) | NOT NULL | 创建时间 |
| updated_at | DATETIME(6) | NOT NULL | 更新时间 |

**唯一约束**: `UNIQUE (chapter_id, position)` 防止同一位置两行；**或**用 `UNIQUE (chapter_id, shot_id)` 若规定每镜至多出现一次（与当前 spec 一致，推荐 **每 shot 每章节至多一条**）。

**关系**:

- `Chapter` 1 : N `ChapterTimelineSegment`
- `Shot` 1 : 0..1 `ChapterTimelineSegment`（每章节内）

---

### 文件用途枚举扩展

**描述**: `FileUsageKind` 增加 `chapter_master_video`（或同级命名），表示「章节时间线导出成片」。

| 值 | 说明 |
|----|------|
| chapter_master_video | 由章节时间线拼接导出产生的单一成片 |

`file_usages` 行需填写 `project_id`（从章节反查）、`chapter_id`、`usage_kind`、`source_ref`（建议 `chapter:{chapter_id}:timeline_export:{task_id}` 幂等）。

---

## Relationships

```
Chapter 1 : 1 ChapterTimelineState（可选）
Chapter 1 : N ChapterTimelineSegment
Shot N : 1 Chapter（已由 Shot.chapter_id 表达）
FileItem 1 : N FileUsage（导出成片写入一条 usage）
GenerationTask 1 : N GenerationTaskLink（relation_entity_id = chapter_id）
```

---

## DDL Scripts（MySQL 8，示意）

```sql
-- 可选：章节时间线状态
CREATE TABLE chapter_timeline_states (
    chapter_id VARCHAR(64) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    layout_version INT NOT NULL DEFAULT 1,
    PRIMARY KEY (chapter_id),
    CONSTRAINT fk_cts_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE chapter_timeline_segments (
    id VARCHAR(64) NOT NULL,
    chapter_id VARCHAR(64) NOT NULL,
    shot_id VARCHAR(64) NOT NULL,
    position INT NOT NULL,
    trim_start_ms INT NULL,
    trim_end_ms INT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_chapter_shot (chapter_id, shot_id),
    UNIQUE KEY uq_chapter_position (chapter_id, position),
    KEY ix_segment_chapter (chapter_id),
    CONSTRAINT fk_seg_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
    CONSTRAINT fk_seg_shot FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## Migration Notes

- 与仓库现有习惯对齐：若使用 `backend/sql/*.sql` 由 compose `mysql-init-sql` 应用，则新增排序后的 SQL 文件；若使用 Alembic（若存在）则按项目惯例二选一。
- **删除章节**时级联删除片段与状态行（ON DELETE CASCADE）。
- **删除镜头**时：片段行 ON DELETE CASCADE **或** 在应用层禁止删镜头直至移出时间线——推荐 **CASCADE** 简化数据。
