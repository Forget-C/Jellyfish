"""reconcile legacy runtime data

Revision ID: 2a7d9c4f8e31
Revises: 05e1c5a7a117
Create Date: 2026-07-18
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "2a7d9c4f8e31"
down_revision: str | Sequence[str] | None = "05e1c5a7a117"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the singleton settings row and normalize retired shot statuses.

    The former `006` SQL initializer created the settings row, while `003`
    converted the removed `generating` shot status. Keeping those data changes
    in a versioned revision preserves the old startup behavior for both legacy
    databases and brand-new Alembic installations.
    """
    op.execute(
        sa.text(
            """
            INSERT INTO model_settings (id, api_timeout, log_level)
            SELECT 1, 30, 'info'
            WHERE NOT EXISTS (SELECT 1 FROM model_settings WHERE id = 1)
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE shots AS s
            SET status = CASE
                WHEN s.skip_extraction = 1 THEN 'ready'
                WHEN s.last_extracted_at IS NULL THEN 'pending'
                WHEN NOT EXISTS (
                    SELECT 1
                    FROM shot_extracted_candidates AS ac
                    WHERE ac.shot_id = s.id AND ac.candidate_status = 'pending'
                ) AND NOT EXISTS (
                    SELECT 1
                    FROM shot_extracted_dialogue_candidates AS dc
                    WHERE dc.shot_id = s.id AND dc.candidate_status = 'pending'
                ) THEN 'ready'
                ELSE 'pending'
            END
            WHERE s.status = 'generating'
            """
        )
    )


def downgrade() -> None:
    """Refuse lossy rollback of data normalization after it has been applied."""
    raise NotImplementedError(
        "Legacy status normalization and singleton settings creation are not safely reversible."
    )
