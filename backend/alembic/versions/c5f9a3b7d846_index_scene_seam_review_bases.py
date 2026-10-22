"""Index fixed seam bases; historical timelines are backfilled only during upgrade."""
from alembic import op
import sqlalchemy as sa

from app.core.contracts.directing.scene_version import SceneVersionContent
from app.services.directing.seam_basis import seam_review_basis_key

revision = 'c5f9a3b7d846'
down_revision = 'b4e8f2a6c735'
branch_labels = None
depends_on = None


def upgrade():
    """Validate historical seam snapshots in bounded batches; ordinary reads never backfill."""
    name = 'directing_scene_seam_reviews'
    op.add_column(name, sa.Column('basis_key', sa.String(64), nullable=True))
    table = sa.table(name, sa.column('id', sa.String(64)), sa.column('review', sa.JSON()),
        sa.column('content', sa.JSON()), sa.column('basis_key', sa.String(64)))
    bind = op.get_bind()
    after = ''
    while True:
        rows = bind.execute(sa.select(table.c.id, table.c.review, table.c.content).where(
            table.c.id > after).order_by(table.c.id).limit(32)).all()
        if not rows:
            break
        for row in rows:
            key = seam_review_basis_key(SceneVersionContent.model_validate(row.content),
                row.review['left_clip_id'], row.review['right_clip_id'])
            bind.execute(table.update().where(table.c.id == row.id).values(basis_key=key))
        after = rows[-1].id
    with op.batch_alter_table(name) as batch:
        batch.alter_column('basis_key', existing_type=sa.String(64), nullable=False)
        batch.create_index('ix_scene_seam_review_basis', ['version_id', 'basis_key'])


def downgrade():
    """Remove only the derived index; fixed historical content remains intact."""
    with op.batch_alter_table('directing_scene_seam_reviews') as batch:
        batch.drop_index('ix_scene_seam_review_basis')
        batch.drop_column('basis_key')
