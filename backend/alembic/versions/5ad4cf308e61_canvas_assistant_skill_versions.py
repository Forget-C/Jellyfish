"""Retain the product skill versions used by each canvas assistant turn."""

from alembic import op
import sqlalchemy as sa

revision = '5ad4cf308e61'
down_revision = '64d201eb47a0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_turns', sa.Column('skills', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('canvas_assistant_turns', 'skills')
