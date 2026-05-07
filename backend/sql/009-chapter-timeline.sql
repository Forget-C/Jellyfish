-- 章节时间线：状态行（乐观锁版本）与片段表（每章节内每镜至多一条，按 position 排序）

SET @has_chapter_timeline_states = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'chapter_timeline_states'
);

SET @create_chapter_timeline_states = IF(
  @has_chapter_timeline_states = 0,
  'CREATE TABLE chapter_timeline_states (
    chapter_id VARCHAR(64) NOT NULL COMMENT ''章节 ID'',
    updated_at DATETIME(6) NOT NULL COMMENT ''最近保存时间（UTC）'',
    layout_version INT NOT NULL DEFAULT 1 COMMENT ''布局版本（乐观锁，每次成功保存递增）'',
    PRIMARY KEY (chapter_id),
    CONSTRAINT fk_cts_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  'SELECT 1'
);
PREPARE stmt_cts FROM @create_chapter_timeline_states;
EXECUTE stmt_cts;
DEALLOCATE PREPARE stmt_cts;

-- 兼容早期未带 DEFAULT 的状态表结构：确保 updated_at 自动赋值
SET @fix_cts_updated_at_default = IF(
  @has_chapter_timeline_states = 1,
  'ALTER TABLE chapter_timeline_states
     MODIFY updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT ''最近保存时间（UTC）''',
  'SELECT 1'
);
PREPARE stmt_fix_cts_ts FROM @fix_cts_updated_at_default;
EXECUTE stmt_fix_cts_ts;
DEALLOCATE PREPARE stmt_fix_cts_ts;

SET @has_chapter_timeline_segments = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'chapter_timeline_segments'
);

SET @create_chapter_timeline_segments = IF(
  @has_chapter_timeline_segments = 0,
  'CREATE TABLE chapter_timeline_segments (
    id VARCHAR(64) NOT NULL COMMENT ''片段行 ID（UUID）'',
    chapter_id VARCHAR(64) NOT NULL COMMENT ''所属章节'',
    shot_id VARCHAR(64) NOT NULL COMMENT ''对应镜头'',
    position INT NOT NULL COMMENT ''从 0 起的播放顺序'',
    trim_start_ms INT NULL COMMENT ''入点毫秒（P2；空表示从头）'',
    trim_end_ms INT NULL COMMENT ''出点毫秒（P2；空表示到尾）'',
    created_at DATETIME(6) NOT NULL COMMENT ''创建时间'',
    updated_at DATETIME(6) NOT NULL COMMENT ''更新时间'',
    PRIMARY KEY (id),
    UNIQUE KEY uq_chapter_shot (chapter_id, shot_id),
    UNIQUE KEY uq_chapter_position (chapter_id, position),
    KEY ix_segment_chapter (chapter_id),
    KEY ix_segment_shot (shot_id),
    CONSTRAINT fk_seg_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
    CONSTRAINT fk_seg_shot FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  'SELECT 1'
);
PREPARE stmt_seg FROM @create_chapter_timeline_segments;
EXECUTE stmt_seg;
DEALLOCATE PREPARE stmt_seg;

-- 兼容早期未带 DEFAULT 的表结构：确保 created_at/updated_at 可自动赋值
SET @fix_seg_timestamp_default = IF(
  @has_chapter_timeline_segments = 1,
  'ALTER TABLE chapter_timeline_segments
     MODIFY created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT ''创建时间'',
     MODIFY updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT ''更新时间''',
  'SELECT 1'
);
PREPARE stmt_fix_seg_ts FROM @fix_seg_timestamp_default;
EXECUTE stmt_fix_seg_ts;
DEALLOCATE PREPARE stmt_fix_seg_ts;
