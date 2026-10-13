"""Preserve explicit instruction basis confirmations independently of editable content."""
from alembic import op
import sqlalchemy as sa

revision = 'e5a9b3d7f846'
down_revision = 'd4f8a2c6e735'
branch_labels = None
depends_on = None


def upgrade():
    """No existing instruction is silently considered confirmed."""
    op.create_table('directing_instruction_bases',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('version_id', sa.String(64), sa.ForeignKey('directing_scene_versions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('unit_id', sa.String(64), nullable=False),
        sa.Column('request_id', sa.String(64), nullable=False),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('inputs', sa.JSON(), nullable=False),
        sa.Column('instruction', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('version_id', 'unit_id', 'request_id', name='uq_instruction_basis_request'))


def downgrade():
    """A populated confirmation history cannot be silently discarded."""
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM directing_instruction_bases')).scalar():
        raise RuntimeError('Instruction bases exist; preserve their data before downgrading')
    op.drop_table('directing_instruction_bases')
