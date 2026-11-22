"""Persist the reference files and observed evidence for assistant turns."""

from alembic import op
import sqlalchemy as sa

revision = 'd45f68b91ce2'
down_revision = '5ad4cf308e61'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_turns', sa.Column('attachments', sa.JSON(), nullable=True))


def downgrade():
    op.execute(sa.text("DELETE FROM file_usages WHERE usage_kind = 'canvas_assistant_attachment'"))
    op.drop_column('canvas_assistant_turns', 'attachments')
