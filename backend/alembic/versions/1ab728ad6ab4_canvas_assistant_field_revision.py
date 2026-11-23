"""Associate a revised change with its immutable proposal group and field."""

import sqlalchemy as sa
from alembic import op

revision = '1ab728ad6ab4'
down_revision = '486a7973cd2e'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_turns', sa.Column('revises_field', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('canvas_assistant_turns', 'revises_field')
