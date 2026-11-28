"""Apply the v1.1.0 schema delta to the published v1.0.0 database."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME, MEDIUMBLOB, MEDIUMTEXT


revision = "a9d237cc18e1"
down_revision = "174afba8895d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('models', sa.Column('capability_profile', sa.JSON(), nullable=True))

    op.add_column('experiment_sessions', sa.Column('chat_models', sa.JSON(), nullable=True))
    op.add_column('experiment_sessions', sa.Column('active_turn', sa.String(64), nullable=True))
    op.add_column('experiment_sessions', sa.Column('chat_execution', sa.JSON(), nullable=True))
    op.add_column('experiment_sessions', sa.Column('chat_lease_until', sa.DateTime(), nullable=True))
    op.create_index('ix_experiment_sessions_chat_lease', 'experiment_sessions', ['chat_lease_until'])

    op.create_table(
        'canvas_assistant_sessions',
        sa.Column('canvas_id', sa.String(64), sa.ForeignKey('generation_canvases.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('pending_token', sa.String(32), nullable=True),
        sa.Column('pending_until', sa.DateTime(), nullable=True),
        sa.Column('model_id', sa.String(64), nullable=True),
        sa.Column('approval_mode', sa.String(12), nullable=False, server_default='manual'),
        sa.Column('pending_request', sa.JSON(), nullable=True),
        sa.Column('pending_checkpoint', sa.LargeBinary().with_variant(MEDIUMBLOB(), 'mysql'), nullable=True),
        sa.Column('event_cursor', sa.Integer(), server_default='0', nullable=False),
        sa.Column('approval_revision', sa.Integer(), server_default='0', nullable=False),
    )

    op.create_table(
        'canvas_assistant_turns',
        sa.Column('canvas_id', sa.String(64), sa.ForeignKey('canvas_assistant_sessions.canvas_id', ondelete='CASCADE'), primary_key=True),
        sa.Column('request_id', sa.String(64), primary_key=True),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('model_id', sa.String(64), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('reply', sa.Text().with_variant(MEDIUMTEXT(), 'mysql'), nullable=False),
        sa.Column('context', sa.JSON(), nullable=True),
        sa.Column('skills', sa.JSON(), nullable=True),
        sa.Column('attachments', sa.JSON(), nullable=True),
        sa.Column('proposal', sa.JSON(), nullable=True),
        sa.Column('proposal_receipt', sa.JSON(), nullable=True),
        sa.Column('revises', sa.String(64), nullable=True),
        sa.Column('approval_audit', sa.JSON(), nullable=True),
        sa.Column('stopped', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('layout', sa.JSON(), nullable=True),
        sa.Column('question_answers', sa.JSON(), nullable=True),
        sa.Column('instructions', sa.JSON(), nullable=True),
        sa.Column('revises_field', sa.JSON(), nullable=True),
        sa.Column('approval_checkpoint', sa.LargeBinary().with_variant(MEDIUMBLOB(), 'mysql'), nullable=True),
        sa.Column('subtasks', sa.JSON(), nullable=True),
        sa.Column('canvas_references', sa.JSON(), nullable=True),
        sa.Column('proposal_issues', sa.JSON(), nullable=True),
        sa.Column('repairs', sa.String(64), nullable=True),
        sa.Column('approval_requests', sa.JSON(), nullable=True),
        sa.Column('expired_approval_kinds', sa.JSON(), nullable=True),
        sa.UniqueConstraint('canvas_id', 'sequence', name='uq_canvas_assistant_turn_sequence'),
    )

    op.create_table(
        'model_capability_verifications',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('model_id', sa.String(64), sa.ForeignKey('models.id', ondelete='CASCADE'), nullable=False),
        sa.Column('configuration_hash', sa.String(64), nullable=False),
        sa.Column('provider_id', sa.String(64), nullable=False),
        sa.Column('provider_name', sa.String(255), nullable=False),
        sa.Column('model_name', sa.String(255), nullable=False),
        sa.Column('endpoint', sa.Text, nullable=False),
        sa.Column('capability', sa.String(32), nullable=False),
        sa.Column('outcome', sa.String(16), nullable=False),
        sa.Column('reason', sa.String(32), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_model_capability_verifications_model_id', 'model_capability_verifications', ['model_id'])

    op.create_table(
        'canvas_assistant_generations',
        sa.Column('canvas_id', sa.String(64), nullable=False),
        sa.Column('source_id', sa.String(64), nullable=False),
        sa.Column('card_id', sa.String(64), nullable=False),
        sa.Column('requested_count', sa.Integer(), nullable=False),
        sa.Column('state', sa.String(24), nullable=False),
        sa.Column('expected_revision', sa.Integer(), nullable=False),
        sa.Column('basis_hash', sa.String(64), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('review_request', sa.Text(), nullable=True),
        sa.Column('review_state', sa.String(16), nullable=True),
        sa.Column('review_results', sa.JSON(), nullable=True),
        sa.Column('review_token', sa.String(32), nullable=True),
        sa.Column('review_lease_until', sa.DateTime(), nullable=True),
        sa.Column('input_approval', sa.JSON(), nullable=True),
        sa.Column('event_digest', sa.String(64), nullable=True),
        sa.Column('events_closed', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('event_checked_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(('canvas_id', 'source_id'), ('canvas_assistant_turns.canvas_id', 'canvas_assistant_turns.request_id'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id', 'source_id'),
    )
    op.create_index('ix_canvas_assistant_generation_queue', 'canvas_assistant_generations', ['state', 'created_at'])
    op.create_index('ix_canvas_assistant_generation_review', 'canvas_assistant_generations', ['review_state', 'created_at'])

    op.create_table(
        'canvas_assistant_events',
        sa.Column('canvas_id', sa.String(64), sa.ForeignKey('canvas_assistant_sessions.canvas_id', ondelete='CASCADE'), primary_key=True),
        sa.Column('cursor', sa.Integer(), primary_key=True),
        sa.Column('source_id', sa.String(64), nullable=False),
        sa.Column('kind', sa.String(40), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )

    op.create_table(
        'canvas_assistant_queue',
        sa.Column('canvas_id', sa.String(64), sa.ForeignKey('canvas_assistant_sessions.canvas_id', ondelete='CASCADE'), primary_key=True),
        sa.Column('request_id', sa.String(64), primary_key=True),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('state', sa.String(12), nullable=False),
        sa.Column('turn_id', sa.String(64), nullable=True),
        sa.Column('request_digest', sa.String(64), nullable=False),
        sa.Column('command', sa.JSON(), nullable=False),
        sa.UniqueConstraint('canvas_id', 'turn_id', name='uq_canvas_assistant_queue_turn'),
    )
    op.create_index('ix_canvas_assistant_queue_order', 'canvas_assistant_queue', ('canvas_id', 'state', 'position'))

    op.create_table(
        'approval_subjects',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('scope_key', sa.String(64), nullable=False),
        sa.Column('scope_kind', sa.String(64), nullable=False),
        sa.Column('scope_id', sa.String(128), nullable=False),
        sa.Column('object_type', sa.String(64), nullable=False),
        sa.Column('object_id', sa.String(128), nullable=False),
        sa.Column('active_request_id', sa.String(64)),
    )
    op.create_index('ix_approval_subjects_scope_key', 'approval_subjects', ['scope_key'])

    op.create_table(
        'approval_requests',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('subject_id', sa.String(64), sa.ForeignKey('approval_subjects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('version', sa.String(128), nullable=False),
        sa.Column('submission_key', sa.String(64), nullable=False, unique=True),
        sa.Column('submission_hash', sa.String(64), nullable=False),
        sa.Column('applicant_id', sa.String(128), nullable=False),
        sa.Column('snapshot_ref', sa.String(255), nullable=False),
        sa.Column('group_ids', sa.JSON(), nullable=False),
        sa.Column('group_states', sa.JSON(), nullable=False),
        sa.Column('supersedes_request_id', sa.String(64)),
    )
    op.create_index('ix_approval_requests_subject_id', 'approval_requests', ['subject_id'])

    op.create_table(
        'approval_decisions',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('request_id', sa.String(64), sa.ForeignKey('approval_requests.id', ondelete='CASCADE'), nullable=False),
        sa.Column('intent_hash', sa.String(64), nullable=False),
        sa.Column('actor_id', sa.String(128), nullable=False),
        sa.Column('action', sa.String(8), nullable=False),
        sa.Column('source', sa.String(12), nullable=False),
        sa.Column('group_ids', sa.JSON(), nullable=False),
        sa.Column('decided_at', sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql'), nullable=False),
    )
    op.create_index('ix_approval_decisions_request_id', 'approval_decisions', ['request_id'])

    op.create_table(
        'canvas_edit_approval_snapshots',
        sa.Column('request_id', sa.String(64), sa.ForeignKey('approval_requests.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('canvas_id', sa.String(64), nullable=False),
        sa.Column('project_id', sa.String(64)),
        sa.Column('plan', sa.JSON(), nullable=False),
        sa.Column('next_scan_at', sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql')),
    )
    op.create_index('ix_canvas_edit_approval_snapshots_next_scan_at', 'canvas_edit_approval_snapshots', ['next_scan_at'])

    op.create_table(
        'canvas_edit_approval_executions',
        sa.Column('decision_id', sa.String(64), sa.ForeignKey('approval_decisions.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('group_key', sa.String(64), primary_key=True),
        sa.Column('group_id', sa.String(64), nullable=False),
        sa.Column('request_id', sa.String(64), sa.ForeignKey('canvas_edit_approval_snapshots.request_id', ondelete='CASCADE'), nullable=False),
        sa.Column('receipt', sa.JSON(), nullable=False),
    )
    op.create_index('ix_canvas_edit_approval_executions_request_id', 'canvas_edit_approval_executions', ['request_id'])

    op.create_table(
        'canvas_generation_approvals',
        sa.Column('request_id', sa.String(64), sa.ForeignKey('approval_requests.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('canvas_id', sa.String(64), nullable=False),
        sa.Column('project_id', sa.String(64)),
        sa.Column('card_id', sa.String(64), nullable=False),
        sa.Column('group_id', sa.String(64), nullable=False),
        sa.Column('basis_hash', sa.String(64), nullable=False),
        sa.Column('preview', sa.JSON(), nullable=False),
        sa.Column('next_scan_at', sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql')),
        sa.Column('state', sa.String(16), nullable=False),
        sa.Column('decision_id', sa.String(64)),
        sa.Column('task_id', sa.String(64), unique=True),
        sa.Column('admission', sa.JSON()),
        sa.Column('diagnostic', sa.JSON()),
    )
    op.create_index('ix_canvas_generation_approvals_next_scan_at', 'canvas_generation_approvals', ['next_scan_at'])

    op.create_table(
        'canvas_assistant_previews',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('canvas_id', sa.String(64), nullable=False),
        sa.Column('project_id', sa.String(64), nullable=True),
        sa.Column('source_id', sa.String(64), nullable=False),
        sa.Column('model_id', sa.String(64), nullable=False),
        sa.Column('basis', sa.String(64), nullable=False),
        sa.Column('draft', sa.Boolean(), nullable=False),
        sa.Column('snapshot', sa.JSON(), nullable=False),
        sa.Column('submitted_source', sa.String(64), nullable=True),
    )

    op.create_table(
        'experiment_session_events',
        sa.Column('cursor', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('session_id', sa.String(64), sa.ForeignKey('experiment_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('turn_id', sa.String(64), nullable=False),
        sa.Column('kind', sa.String(64), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sqlite_autoincrement=True,
    )
    op.create_index('ix_experiment_events_session_cursor', 'experiment_session_events', ['session_id', 'cursor'])


def downgrade() -> None:
    op.drop_table('experiment_session_events')
    op.drop_table('canvas_assistant_previews')
    op.drop_table('canvas_generation_approvals')
    op.drop_table('canvas_edit_approval_executions')
    op.drop_table('canvas_edit_approval_snapshots')
    op.drop_table('approval_decisions')
    op.drop_table('approval_requests')
    op.drop_table('approval_subjects')
    op.drop_table('canvas_assistant_queue')
    op.drop_table('canvas_assistant_events')
    op.drop_table('canvas_assistant_generations')
    op.drop_table('model_capability_verifications')
    op.drop_table('canvas_assistant_turns')
    op.drop_table('canvas_assistant_sessions')

    op.drop_index('ix_experiment_sessions_chat_lease', table_name='experiment_sessions')
    op.drop_column('experiment_sessions', 'chat_lease_until')
    op.drop_column('experiment_sessions', 'chat_execution')
    op.drop_column('experiment_sessions', 'active_turn')
    op.drop_column('experiment_sessions', 'chat_models')
    op.drop_column('models', 'capability_profile')
