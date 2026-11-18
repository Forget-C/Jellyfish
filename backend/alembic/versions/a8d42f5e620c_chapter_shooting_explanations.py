"""Move shooting explanations to the chapter source version."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME, MEDIUMTEXT

revision = 'a8d42f5e620c'
down_revision = 'f7a3c9e215b0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'directing_chapter_shooting_explanations',
        sa.Column('chapter_id', sa.String(64), sa.ForeignKey('chapters.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('source_version', sa.String(64), primary_key=True),
        sa.Column('raw_text', sa.Text().with_variant(MEDIUMTEXT(), 'mysql'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('preparation', sa.JSON(), nullable=False),
        sa.Column('last_request_id', sa.String(64)),
        sa.Column('last_request_hash', sa.String(64)),
        sa.Column('created_at', sa.DateTime(timezone=True).with_variant(DATETIME(fsp=6), 'mysql'),
                  server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.drop_column('directing_sequences', 'shooting_preparation')


def downgrade():
    op.add_column('directing_sequences', sa.Column('shooting_preparation', sa.JSON(), nullable=True))
    op.drop_table('directing_chapter_shooting_explanations')
