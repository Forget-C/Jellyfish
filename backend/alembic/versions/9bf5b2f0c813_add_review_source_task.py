"""Persist the exact review task applied to a confirmed revision."""
from alembic import op
import sqlalchemy as sa

revision = '9bf5b2f0c813'
down_revision = '8ac4e702bf58'
branch_labels = None
depends_on = None


def upgrade():
    """Keep historical revisions unchanged; never infer task identity from matching text."""
    with op.batch_alter_table('directing_revisions') as batch:
        batch.add_column(sa.Column('source_task_id', sa.String(64), nullable=True))
        batch.create_foreign_key('fk_directing_revision_source_task', 'tasks', ['source_task_id'], ['id'], ondelete='RESTRICT')
        batch.create_unique_constraint('uq_directing_revision_source_task', ['source_task_id'])


def downgrade():
    """Remove the task association while preserving all review contents and versions."""
    with op.batch_alter_table('directing_revisions') as batch:
        batch.drop_constraint('uq_directing_revision_source_task', type_='unique')
        batch.drop_constraint('fk_directing_revision_source_task', type_='foreignkey')
        batch.drop_column('source_task_id')
