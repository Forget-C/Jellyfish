-- 010-add-cas-production-tables.sql
-- CAS 生产流水线表：任务 / 生产镜头 / 产物。
-- 说明：仅记录**生产运行状态与产物**，不复制 Jellyfish 的 Project/Chapter/Shot/Asset 等创作实体。
-- project_id / episode_id / source_shot_id 为弱引用（不建外键），以避免与创作域耦合并支持
-- 尚未导入到 Chapter 的独立生产运行。

CREATE TABLE IF NOT EXISTS `cas_production_jobs` (
  `id` VARCHAR(64) NOT NULL COMMENT '任务 ID（UUID）',
  `project_id` VARCHAR(64) NOT NULL COMMENT '项目 ID（弱引用）',
  `episode_id` VARCHAR(255) NOT NULL COMMENT 'Episode ID（弱引用）',
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT '任务状态：pending/running/completed/failed/cancelled',
  `current_stage` VARCHAR(32) NOT NULL DEFAULT 'validate' COMMENT '当前阶段',
  `episode_package_hash` VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'EpisodePackage 规范化 SHA-256',
  `provider_mode` VARCHAR(32) NOT NULL DEFAULT 'mock' COMMENT '供应商模式（本冲刺仅 mock）',
  `started_at` DATETIME NULL COMMENT '开始时间',
  `completed_at` DATETIME NULL COMMENT '完成时间',
  `error_message` TEXT NOT NULL COMMENT '错误信息',
  `output_path` VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '任务输出根目录（相对存储根）',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `ix_cas_prod_jobs_project_id` (`project_id`),
  KEY `ix_cas_prod_jobs_episode_id` (`episode_id`),
  KEY `ix_cas_prod_jobs_project_episode` (`project_id`, `episode_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CAS 生产任务';

CREATE TABLE IF NOT EXISTS `cas_production_shots` (
  `id` VARCHAR(64) NOT NULL COMMENT '生产镜头 ID（UUID）',
  `job_id` VARCHAR(64) NOT NULL COMMENT '所属任务 ID',
  `source_shot_id` VARCHAR(255) NOT NULL COMMENT 'EpisodePackage 中的 shot_id（弱引用）',
  `sequence` INT NOT NULL COMMENT '镜头顺序',
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT '镜头生产状态',
  `current_stage` VARCHAR(32) NOT NULL DEFAULT 'validate' COMMENT '当前阶段',
  `image_prompt` TEXT NOT NULL COMMENT '图像提示词',
  `negative_prompt` TEXT NOT NULL COMMENT '反向提示词',
  `video_prompt` TEXT NOT NULL COMMENT '视频提示词',
  `duration_seconds` DOUBLE NOT NULL DEFAULT 0 COMMENT '镜头时长（秒）',
  `error_message` TEXT NOT NULL COMMENT '错误信息',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `ix_cas_prod_shots_job_id` (`job_id`),
  KEY `ix_cas_prod_shots_job_sequence` (`job_id`, `sequence`),
  CONSTRAINT `fk_cas_prod_shots_job`
    FOREIGN KEY (`job_id`) REFERENCES `cas_production_jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CAS 生产镜头（仅生产状态）';

CREATE TABLE IF NOT EXISTS `cas_production_artifacts` (
  `id` VARCHAR(64) NOT NULL COMMENT '产物 ID（UUID）',
  `job_id` VARCHAR(64) NOT NULL COMMENT '所属任务 ID',
  `production_shot_id` VARCHAR(64) NULL COMMENT '所属生产镜头 ID（可空：任务级产物）',
  `artifact_type` VARCHAR(32) NOT NULL COMMENT '产物类型：prompt/image/video/voice/subtitle/music/manifest/final_video/log',
  `stage` VARCHAR(32) NOT NULL COMMENT '产生该产物的阶段',
  `provider` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '供应商标识',
  `provider_model` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '供应商模型标识',
  `file_path` VARCHAR(1024) NOT NULL COMMENT '产物文件路径（相对存储根）',
  `mime_type` VARCHAR(128) NOT NULL DEFAULT '' COMMENT 'MIME 类型',
  `checksum` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '文件 SHA-256',
  `metadata_json` JSON NOT NULL COMMENT '附加元信息',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `ix_cas_prod_artifacts_job_id` (`job_id`),
  KEY `ix_cas_prod_artifacts_shot_id` (`production_shot_id`),
  KEY `ix_cas_prod_artifacts_type` (`artifact_type`),
  KEY `ix_cas_prod_artifacts_job_type` (`job_id`, `artifact_type`),
  CONSTRAINT `fk_cas_prod_artifacts_job`
    FOREIGN KEY (`job_id`) REFERENCES `cas_production_jobs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cas_prod_artifacts_shot`
    FOREIGN KEY (`production_shot_id`) REFERENCES `cas_production_shots` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CAS 生产产物（Artifact First）';
