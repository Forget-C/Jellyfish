"""Retire old assistant approval state while preserving accepted effects and history."""

from datetime import UTC, datetime
from hashlib import sha256

from fastapi import HTTPException
from sqlalchemy import MetaData, Table, select
from sqlalchemy.engine import Connection

APPROVAL_PROTOCOL_VERSION = 2
_EXPIRED = '此审批已失效，请重新发起'
_RETIRED_GENERATION = '升级前未受理的生成已失效，已受理任务继续按原标识跟踪'
_UNKNOWN_SUBMISSION = '供应商受理结果未确定，系统保留原任务供核对'
_PENDING_GENERATION_STATES = {'waiting_approval', 'queued', 'reapproval_required'}
_PENDING_LAYOUT_STATES = {'proposed', 'waiting', 'executing'}
_TURN_FIELDS = (
    'request_id', 'text', 'reply', 'model_id', 'sequence', 'context', 'attachments', 'canvas_references',
    'proposal', 'proposal_issues', 'revises', 'revises_field', 'repairs', 'skills', 'subtasks',
    'approval_audit', 'stopped', 'layout', 'question_answers', 'instructions',
)


def expired_approval() -> HTTPException:
    """Use the same actionable response for any retired approval surface."""
    return HTTPException(409, _EXPIRED)


def require_unexpired_approval(turn, kind: str) -> None:
    """Reject held legacy UI after migration; the new runtime also requires its own linked request."""
    if turn is not None and kind in (turn.expired_approval_kinds or ()):
        raise expired_approval()


def legacy_generation_request_id(source_id: str, version: int) -> str:
    """Compute the original identity of an admitted legacy generation only for reads."""
    return 'assistant-run:' + sha256(f'{version}:{source_id}'.encode()).hexdigest()[:48]


def _retire_proposal(proposal: dict | None) -> dict | None:
    if not proposal:
        return proposal
    groups = proposal.get('groups')
    if proposal.get('state') != 'pending' and not any(item.get('state') == 'pending' for item in groups or ()):
        return proposal
    retired = {**proposal, 'state': 'superseded'}
    if groups:
        retired['groups'] = [{**item, 'state': 'superseded'} if item.get('state') == 'pending' else item for item in groups]
    return retired


def _retire_layout(layout: dict | None) -> dict | None:
    return {**layout, 'state': 'stale'} if layout and layout.get('state') in _PENDING_LAYOUT_STATES else layout


def _retire_generation_snapshot(generation: dict | None) -> dict | None:
    if not generation or generation.get('state') not in _PENDING_GENERATION_STATES:
        return generation
    return {**generation, 'state': 'stopped', 'error': _RETIRED_GENERATION, 'changed_input': None}


class _ApprovalUpgrade:
    """Apply to a quiesced database using only the fields of this schema version."""

    def __init__(self, connection: Connection):
        self.db = connection
        metadata = MetaData()

        def table(name):
            return Table(name, metadata, autoload_with=connection, resolve_fks=False)

        self.sessions = table('canvas_assistant_sessions')
        self.turns = table('canvas_assistant_turns')
        self.events = table('canvas_assistant_events')
        self.queue = table('canvas_assistant_queue')
        self.generations = table('canvas_assistant_generations')
        self.receipts = table('generation_canvas_run_receipts')
        self.runs = table('generation_canvas_runs')
        self.nodes = table('generation_canvas_run_nodes')
        self.tasks = table('tasks')
        self.now = datetime.now(UTC).replace(tzinfo=None)

    def run(self) -> None:
        after = None
        while True:
            query = select(self.sessions).order_by(self.sessions.c.canvas_id).limit(64)
            if after:
                query = query.where(self.sessions.c.canvas_id > after)
            batch = self.db.execute(query).mappings().all()
            if not batch:
                return
            for session in batch:
                self._session(session)
            after = batch[-1]['canvas_id']

    def _session(self, session) -> None:
        canvas_id = session['canvas_id']
        stale = {}
        events = self.events
        generation_rows = {row['source_id']: row for row in self.db.execute(
            select(self.generations).where(self.generations.c.canvas_id == canvas_id),
        ).mappings()}
        rows = self.db.execute(select(self.turns).where(self.turns.c.canvas_id == canvas_id)
                               .order_by(self.turns.c.sequence)).mappings()
        for turn in rows:
            if changed := self._turn(turn, generation_rows.get(turn['request_id'])):
                stale[turn['request_id']] = changed
        removed = self._clear_pending(session)
        if not stale and not removed:
            return

        # Older cursors must never resurrect an action. Keep their original envelopes, prose and cursor.
        identities = set(stale) | set(removed)
        history = self.db.execute(select(events).where(events.c.canvas_id == canvas_id,
            events.c.source_id.in_(identities)).order_by(events.c.cursor)).mappings()
        latest = {}
        for event in history:
            values = event['payload']
            source_id = event['source_id']
            kinds = stale.get(source_id, ((), None, None))[0]
            updated = self._without_old_actions(values, kinds)
            if event['kind'].startswith('queue.') and source_id in removed and updated.get('state') == 'admitted':
                updated = {**updated, 'state': 'removed'}
            if updated != values:
                self.db.execute(events.update().where(events.c.canvas_id == canvas_id,
                    events.c.cursor == event['cursor']).values(payload=updated))
            latest[source_id] = updated

        cursor = max(session['sequence'], session['event_cursor'])
        for source_id, (kinds, payload, generation) in stale.items():
            payload = {**latest.get(source_id, {}), **payload}
            if 'edit' in kinds:
                payload['automatic_approval'] = False
                cursor = self._append(canvas_id, cursor, source_id, 'proposal.superseded', payload, 'edit')
            if 'layout' in kinds:
                cursor = self._append(canvas_id, cursor, source_id, 'layout.updated', payload, 'layout')
            if 'generation' in kinds:
                cursor = self._append(canvas_id, cursor, source_id, 'generation.updated',
                                      {**payload, 'generation': generation}, 'generation')
        for source_id, payload in removed.items():
            cursor = self._append(canvas_id, cursor, source_id, 'queue.removed', payload)
        self.db.execute(self.sessions.update().where(self.sessions.c.canvas_id == canvas_id)
                        .values(event_cursor=cursor))

    def _turn(self, turn, generation_entry):
        canvas_id, source_id = turn['canvas_id'], turn['request_id']
        linked = turn['approval_requests'] or {}
        before = set(turn['expired_approval_kinds'] or ())
        updates = {}
        kinds = set()
        if 'edit' not in linked:
            retired = _retire_proposal(turn['proposal'])
            if retired != turn['proposal']:
                updates['proposal'] = retired
                kinds.add('edit')
            if turn['approval_checkpoint'] is not None:
                updates['approval_checkpoint'] = None
                if turn['proposal'] and turn['proposal'].get('state') == 'pending':
                    kinds.add('edit')
        if 'layout' not in linked:
            retired = _retire_layout(turn['layout'])
            if retired != turn['layout']:
                updates['layout'] = retired
                kinds.add('layout')
        generation = None
        if generation_entry is not None and 'generation' not in linked:
            generation, changed = self._generation(generation_entry)
            if changed:
                kinds.add('generation')
        if kinds - before:
            updates['expired_approval_kinds'] = sorted(before | kinds)
        if updates:
            self.db.execute(self.turns.update().where(self.turns.c.canvas_id == canvas_id,
                self.turns.c.request_id == source_id).values(**updates))
        if kinds:
            payload = {field: updates[field] if field in updates else turn[field] for field in _TURN_FIELDS}
            if generation is not None:
                payload['generation'] = generation
            return kinds, payload, generation
        return None

    def _generation(self, entry):
        table = self.generations
        canvas_id, source_id = entry['canvas_id'], entry['source_id']
        identity = (table.c.canvas_id == canvas_id, table.c.source_id == source_id)
        requested = entry['requested_count']
        ids = {legacy_generation_request_id(source_id, version): version for version in range(1, requested + 1)}
        receipts = self.db.execute(select(self.receipts).where(self.receipts.c.canvas_id == canvas_id,
                                                              self.receipts.c.request_id.in_(ids))).mappings().all()
        versions, changed = self._versions(canvas_id, ids, receipts)
        updates = {}
        if entry['state'] in _PENDING_GENERATION_STATES:
            updates.update(state='submitted' if receipts else 'stopped', error=_RETIRED_GENERATION,
                           events_closed=not bool(receipts), event_digest=None)
        approval = entry['input_approval'] or {}
        if 'pending' in approval:
            updates['input_approval'] = {key: value for key, value in approval.items() if key != 'pending'}
        if entry['review_state'] in ('waiting', 'reviewing'):
            updates.update(review_state='stopped', review_token=None, review_lease_until=None)
        if updates:
            self.db.execute(table.update().where(*identity).values(**updates))
        state = updates.get('state', entry['state'])
        error = updates.get('error', entry['error'])
        if state == 'submitted':
            if any(item['state'] not in ('succeeded', 'failed', 'cancelled') for item in versions):
                state = 'running'
            elif len(versions) == requested and all(item['state'] == 'succeeded' for item in versions):
                state = 'completed'
            else:
                state = 'failed'
        review_state = updates.get('review_state', entry['review_state'])
        view = dict(card_id=entry['card_id'], requested_count=requested, state=state, error=error,
                    versions=versions, review={'state': review_state, 'results': entry['review_results'] or []}
                    if review_state else None)
        return view, bool(updates or changed)

    def _versions(self, canvas_id, ids, receipts):
        versions = []
        changed = False
        for receipt in sorted(receipts, key=lambda item: ids[item['request_id']]):
            response = receipt['response']
            run_id = response['run_id']
            node = self.db.execute(select(self.nodes.c.id, self.nodes.c.run_id, self.nodes.c.task_id, self.nodes.c.status,
                                          self.nodes.c.stage, self.nodes.c.error_message, self.runs.c.revision)
                .join(self.runs, self.runs.c.id == self.nodes.c.run_id).where(
                    self.nodes.c.canvas_id == canvas_id, self.nodes.c.run_id == run_id)).mappings().one_or_none()
            if node is None:
                continue
            became_unknown = self._retain_unknown_submission(node)
            changed = changed or became_unknown
            unknown = became_unknown or node['stage'] == 'submission_unknown'
            versions.append(dict(version=ids[receipt['request_id']], request_id=receipt['request_id'],
                run_id=run_id, input_revision=node['revision'], state='unknown' if unknown else node['status'],
                error=_UNKNOWN_SUBMISSION if unknown else node['error_message']))
        return versions, changed

    def _retain_unknown_submission(self, node) -> bool:
        if not node['task_id']:
            return False
        table = self.tasks
        task = self.db.execute(select(table.c.status, table.c.stage, table.c.kind,
                                     table.c.provider_task_id, table.c.error_code)
                               .where(table.c.id == node['task_id'])).mappings().one_or_none()
        if not task or task['provider_task_id'] or task['kind'] not in ('video_generation', 'image_generation'):
            return False
        interrupted = {'submission_interrupted', 'execution_interrupted', 'execution_timeout'}
        if task['status'] != 'running' and (task['status'] != 'failed' or task['error_code'] not in interrupted):
            return False
        if task['stage'] == node['stage'] == 'submission_unknown':
            return False
        fields = dict(status='running', stage='submission_unknown', error_code='submission_unknown',
                      error_message=_UNKNOWN_SUBMISSION)
        self.db.execute(table.update().where(table.c.id == node['task_id']).values(
            **fields, finished_at=None, deadline_at=None, next_poll_at=None,
        ))
        self.db.execute(self.nodes.update().where(self.nodes.c.id == node['id']).values(**fields))
        self.db.execute(self.runs.update().where(self.runs.c.id == node['run_id']).values(lifecycle='active'))
        return True

    def _clear_pending(self, session) -> dict:
        pending = session['pending_request'] or {}
        if pending.get('approval_protocol') == APPROVAL_PROTOCOL_VERSION:
            return {}
        if not (pending or session['pending_token'] or session['pending_checkpoint'] is not None
                or session['pending_until']):
            return {}
        canvas_id = session['canvas_id']
        self.db.execute(self.sessions.update().where(self.sessions.c.canvas_id == canvas_id).values(
            pending_token=None, pending_until=None, pending_request=None, pending_checkpoint=None,
        ))
        old_turn = (pending.get('command') or {}).get('request_id')
        if old_turn is None:
            return {}
        terms = (self.queue.c.canvas_id == canvas_id, self.queue.c.turn_id == old_turn,
                 self.queue.c.state == 'admitted')
        entries = self.db.execute(select(self.queue).where(*terms)).mappings().all()
        if entries:
            self.db.execute(self.queue.update().where(*terms).values(state='removed'))
        return {entry['request_id']: {'request_id': entry['request_id'], 'turn_id': old_turn, 'state': 'removed',
                                     'message': {'text': entry['command']['text']}} for entry in entries}

    @staticmethod
    def _without_old_actions(payload, kinds):
        retired = dict(payload)
        if 'edit' in kinds and retired.get('proposal'):
            retired['proposal'] = _retire_proposal(retired['proposal'])
            retired['automatic_approval'] = False
        if 'layout' in kinds and retired.get('layout'):
            retired['layout'] = _retire_layout(retired['layout'])
        if 'generation' in kinds and retired.get('generation'):
            retired['generation'] = _retire_generation_snapshot(retired['generation'])
        return retired

    def _append(self, canvas_id, cursor, source_id, kind, payload, subject=None):
        if subject:
            payload = {**payload, '_event': {'subject': subject, 'target_version': source_id}}
        self.db.execute(self.events.insert().values(canvas_id=canvas_id, cursor=cursor + 1, source_id=source_id,
            kind=kind, payload=payload, created_at=self.now))
        return cursor + 1


def expire_legacy_canvas_approvals(connection: Connection) -> None:
    """Run after new linkage columns exist and before enabling upgraded API and Workers."""
    _ApprovalUpgrade(connection).run()
