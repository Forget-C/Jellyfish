"""Keep accepted question answers with the original canvas assistant turn."""

import sqlalchemy as sa
from alembic import op

revision = '4a7c406c8f39'
down_revision = 'a17efb08f62d'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_turns', sa.Column('question_answers', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('canvas_assistant_turns', 'question_answers')
