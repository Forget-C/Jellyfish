"""Keep Deep Agents approval interrupts with their published proposals."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import MEDIUMBLOB

revision = '5ed6809eb96d'
down_revision = '1ab728ad6ab4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_turns', sa.Column(
        'approval_checkpoint', sa.LargeBinary().with_variant(MEDIUMBLOB(), 'mysql'), nullable=True,
    ))


def downgrade():
    op.drop_column('canvas_assistant_turns', 'approval_checkpoint')
