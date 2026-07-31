"""remove model configuration revisions and repair generation timestamps

Revision ID: e2b7c6d9f4a3
Revises: d8f4a1e9b702
Create Date: 2026-07-31

Generation tasks now persist only their submitted request snapshot.  Workers
resolve the current model and provider configuration when they execute, so the
obsolete revision schema must not remain a runtime prerequisite.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "e2b7c6d9f4a3"
down_revision: str | Sequence[str] | None = "d8f4a1e9b702"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_ASYNC_GENERATION_TABLES = (
    "generation_artifacts",
    "generation_task_media_references",
    "generation_dispatch_outbox",
)


def _table_exists(table_name: str) -> bool:
    """返回当前数据库是否存在指定表，兼容曾部分执行过旧迁移的开发库。"""

    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _repair_timestamp_defaults(table_name: str) -> None:
    """为异步生成表补齐建表时遗漏的数据库时间默认值。

    ORM 的 TimestampMixin 不会在 INSERT 中显式传入两个时间字段；缺少默认值的
    MySQL 会因此拒绝创建 outbox、媒体引用和产物记录。
    """

    columns = {column["name"]: column for column in sa.inspect(op.get_bind()).get_columns(table_name)}
    with op.batch_alter_table(table_name) as batch_op:
        for column_name in ("created_at", "updated_at"):
            if column_name in columns:
                batch_op.alter_column(
                    column_name,
                    existing_type=sa.DateTime(),
                    existing_nullable=False,
                    server_default=sa.text("CURRENT_TIMESTAMP"),
                )


def _drop_current_revision_reference() -> None:
    """移除 models 对旧 revision 表的引用，先清理命名外键以兼容 create_all 数据库。"""

    if not _table_exists("models"):
        return

    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("models")}
    if "current_revision_id" not in columns:
        return

    for foreign_key in inspector.get_foreign_keys("models"):
        if foreign_key["constrained_columns"] == ["current_revision_id"] and foreign_key.get("name"):
            op.drop_constraint(foreign_key["name"], "models", type_="foreignkey")
    if "ix_models_current_revision_id" in {index["name"] for index in inspector.get_indexes("models")}:
        op.drop_index("ix_models_current_revision_id", table_name="models")
    with op.batch_alter_table("models") as batch_op:
        batch_op.drop_column("current_revision_id")


def upgrade() -> None:
    """停止 revision 存储并修复仍在使用的异步生成表默认值。

    部署顺序：先发布不再读取或写入 revision 的应用代码，再执行本迁移；不能与
    仍依赖 current_revision_id 的旧应用实例滚动混跑。
    """

    for table_name in _ASYNC_GENERATION_TABLES:
        if _table_exists(table_name):
            _repair_timestamp_defaults(table_name)
    _drop_current_revision_reference()
    if _table_exists("model_config_revisions"):
        op.drop_table("model_config_revisions")


def downgrade() -> None:
    """不支持回建 revision 历史，避免伪造已删除的执行配置快照。"""

    raise NotImplementedError("Removing model configuration revisions is irreversible")
