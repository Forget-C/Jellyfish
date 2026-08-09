-- 009-add-cas-import-ledger.sql
-- Crypto Animal Studio (CAS) EpisodePackage 导入台账表。
-- 目的：为导入提供持久化幂等（durable idempotency）。经用户批准新增此轻量记账表。
-- 说明：仅记账，不复制任何 Project/Shot/Asset 业务实体；引用既有 projects / chapters。

CREATE TABLE IF NOT EXISTS `cas_import_ledger` (
  `id` VARCHAR(64) NOT NULL COMMENT '台账行 ID（UUID）',
  `project_id` VARCHAR(64) NOT NULL COMMENT '所属项目 ID',
  `episode_id` VARCHAR(255) NOT NULL COMMENT 'CAS Episode ID',
  `idempotency_key` VARCHAR(255) NOT NULL COMMENT '幂等键',
  `payload_hash` VARCHAR(64) NOT NULL COMMENT 'EpisodePackage 规范化序列化的 SHA-256 十六进制',
  `chapter_id` VARCHAR(64) NULL COMMENT '导入产生的 Chapter ID（章节删除时置空）',
  `status` VARCHAR(32) NOT NULL DEFAULT 'imported' COMMENT '导入状态',
  `schema_version` VARCHAR(16) NOT NULL DEFAULT '' COMMENT 'EpisodePackage 契约版本',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  -- 唯一约束（project_id 作为最左前缀，同时满足 project 外键所需索引）
  UNIQUE KEY `uq_cas_import_project_key` (`project_id`, `idempotency_key`),
  UNIQUE KEY `uq_cas_import_project_episode` (`project_id`, `episode_id`),
  -- chapter 外键需要独立索引；payload_hash 便于按内容排查
  KEY `ix_cas_import_chapter_id` (`chapter_id`),
  KEY `ix_cas_import_payload_hash` (`payload_hash`),
  CONSTRAINT `fk_cas_import_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cas_import_chapter`
    FOREIGN KEY (`chapter_id`) REFERENCES `chapters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CAS EpisodePackage 导入台账';
