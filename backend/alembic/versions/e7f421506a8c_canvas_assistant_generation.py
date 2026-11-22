"""Record assistant generation authorization separately from its execution receipts."""

from alembic import op
import sqlalchemy as sa

revision = 'e7f421506a8c'
down_revision = '1e651692da47'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'canvas_assistant_generations',
        sa.Column('canvas_id', sa.String(64), nullable=False),
        sa.Column('source_id', sa.String(64), nullable=False),
        sa.Column('card_id', sa.String(64), nullable=False),
        sa.Column('requested_count', sa.Integer(), nullable=False),
        sa.Column('state', sa.String(24), nullable=False),
        sa.Column('expected_revision', sa.Integer(), nullable=False),
        sa.Column('basis_hash', sa.String(64), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(('canvas_id', 'source_id'),
            ('canvas_assistant_turns.canvas_id', 'canvas_assistant_turns.request_id'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id', 'source_id'),
    )
    op.create_index('ix_canvas_assistant_generation_queue', 'canvas_assistant_generations', ['state', 'created_at'])


def downgrade():
    op.drop_table('canvas_assistant_generations')
