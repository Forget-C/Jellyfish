"""Keep prior and proposed generation inputs for an explicit reapproval."""

import sqlalchemy as sa
from alembic import op

revision = '9e40d80439be'
down_revision = '9f41d1a8ac20'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_generations', sa.Column('input_approval', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('canvas_assistant_generations', 'input_approval')
