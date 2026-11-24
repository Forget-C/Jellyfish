"""Link new approval versions and retire incompatible requests before cutover.

Run the migration with the old API and Worker stopped so old executors
cannot create work during the data upgrade.
"""

from alembic import op
import sqlalchemy as sa

from app.services.generation_canvas.approval_upgrade import expire_legacy_canvas_approvals

revision = 'd6bf47c2a901'
down_revision = 'bc8c830b630e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    table = 'canvas_assistant_turns'
    names = {column['name'] for column in sa.inspect(connection).get_columns(table)}
    for name in ('approval_requests', 'expired_approval_kinds'):
        if name not in names:
            op.add_column(table, sa.Column(name, sa.JSON(), nullable=True))
    expire_legacy_canvas_approvals(connection)


def downgrade() -> None:
    # Retired decisions and checkpoints cannot be recreated from current history.
    op.drop_column('canvas_assistant_turns', 'expired_approval_kinds')
    op.drop_column('canvas_assistant_turns', 'approval_requests')
