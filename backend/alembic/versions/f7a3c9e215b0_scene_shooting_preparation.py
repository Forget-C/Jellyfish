"""Store scene shooting preparation with the scene."""
from alembic import op
import sqlalchemy as sa

revision = 'f7a3c9e215b0'
down_revision = 'e72c4b6a901d'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('directing_sequences', sa.Column('shooting_preparation', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('directing_sequences', 'shooting_preparation')
