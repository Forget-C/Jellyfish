"""Store assistant edit proposals and their approval receipts."""

from alembic import op
import sqlalchemy as sa

revision = '1e651692da47'
down_revision = '64d201eb47a0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_turns', sa.Column('proposal', sa.JSON(), nullable=True))
    op.add_column('canvas_assistant_turns', sa.Column('proposal_receipt', sa.JSON(), nullable=True))
    op.add_column('canvas_assistant_turns', sa.Column('revises', sa.String(64), nullable=True))


def downgrade():
    op.drop_column('canvas_assistant_turns', 'revises')
    op.drop_column('canvas_assistant_turns', 'proposal_receipt')
    op.drop_column('canvas_assistant_turns', 'proposal')
