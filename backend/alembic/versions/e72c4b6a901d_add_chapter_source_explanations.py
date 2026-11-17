"""Store chapter explanations separately from source text."""
from alembic import op
import sqlalchemy as sa

revision = 'e72c4b6a901d'
down_revision = 'c5e12a6b9f03'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('chapters', sa.Column('source_explanations', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('chapters', 'source_explanations')
