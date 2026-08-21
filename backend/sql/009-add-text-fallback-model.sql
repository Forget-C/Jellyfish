SET @has_fallback_text_column = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'model_settings'
    AND COLUMN_NAME = 'fallback_text_model_id'
);

SET @add_fallback_text_column = IF(
  @has_fallback_text_column = 0,
  "ALTER TABLE model_settings
   ADD COLUMN fallback_text_model_id VARCHAR(64) NULL
   COMMENT '文本模型失败回退模型 ID（全局统一；空表示关闭回退）'
   AFTER default_text_model_id,
   ADD CONSTRAINT fk_model_settings_fallback_text_model_id
     FOREIGN KEY (fallback_text_model_id) REFERENCES models(id) ON DELETE SET NULL",
  'SELECT 1'
);
PREPARE stmt_add_fallback_text_column FROM @add_fallback_text_column;
EXECUTE stmt_add_fallback_text_column;
DEALLOCATE PREPARE stmt_add_fallback_text_column;
