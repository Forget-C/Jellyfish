"""Index canonical fixed review bases; explicitly backfill historical snapshots."""
from alembic import op
import sqlalchemy as sa

from app.core.contracts.directing.scene_version import SceneVersionContent
from app.services.directing.scene_cut_evidence import cut_review_basis_key
from app.services.directing.scene_take_evidence import take_review_basis_key

revision = 'b4e8f2a6c735'
down_revision = 'a3d7e1f5b624'
branch_labels = None
depends_on = None


def upgrade():
    """One-time bounded batches validate old DTO defaults before indexing; reads never backfill."""
    bind = op.get_bind()
    for name, index, basis in (
        ('directing_scene_take_reviews', 'ix_scene_take_review_basis', take_review_basis_key),
        ('directing_scene_cut_reviews', 'ix_scene_cut_review_basis', cut_review_basis_key),
    ):
        op.add_column(name, sa.Column('basis_key', sa.String(64), nullable=True))
        table = sa.table(name, sa.column('id', sa.String(64)), sa.column('content', sa.JSON()), sa.column('basis_key', sa.String(64)))
        after = ''
        while True:
            rows = bind.execute(sa.select(table.c.id, table.c.content).where(table.c.id > after).order_by(table.c.id).limit(32)).all()
            if not rows:
                break
            for row in rows:
                key = basis(SceneVersionContent.model_validate(row.content))
                bind.execute(table.update().where(table.c.id == row.id).values(basis_key=key))
            after = rows[-1].id
        with op.batch_alter_table(name) as batch:
            batch.alter_column('basis_key', existing_type=sa.String(64), nullable=False)
            batch.create_index(index, ['version_id', 'basis_key'])


def downgrade():
    """Only remove the derived index; fixed content and review identities remain untouched."""
    for name, index in (
        ('directing_scene_take_reviews', 'ix_scene_take_review_basis'),
        ('directing_scene_cut_reviews', 'ix_scene_cut_review_basis'),
    ):
        with op.batch_alter_table(name) as batch:
            batch.drop_index(index)
            batch.drop_column('basis_key')
