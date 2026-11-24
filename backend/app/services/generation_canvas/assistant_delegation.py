"""Dispatch bounded, read-only creative tasks on independent Deep Agents."""

import asyncio
import json

from deepagents import create_deep_agent
from langchain_core.messages import HumanMessage
from langchain_core.tools import ToolException, tool

from app.schemas.canvas_assistant_media import CanvasAssistantAttachment
from app.schemas.canvas_assistant_subtasks import CanvasAssistantSubtask, CanvasDelegationBatch
from app.services.generation_canvas.assistant_auto_review import review_without_tools
from app.services.generation_canvas.assistant_skills import skill_catalog
from app.services.generation_canvas.store import CanvasStore

_ROLE_SKILLS = {
    'storyboard-design': ('script-planning', 'shot-staging'),
    'footage-continuity-review': ('footage-review',),
}


class CanvasDelegation:
    """Use the same role registry, bounded inputs and DAG for both model paths."""

    def __init__(self, client, model_id, context, content, attachments, checkpoint, completed):
        self._client = client
        self._model_id = model_id
        self._cards = {card['id']: card for card in context.cards} if context else {}
        self._content = content
        self._attachments = attachments
        self._checkpoint = checkpoint
        self._completed = completed
        self._batch_lock = asyncio.Lock()
        self.results: dict[str, CanvasAssistantSubtask] = {
            key: CanvasAssistantSubtask.model_validate(value['result']) for key, value in completed.items()
        }

    def tool(self):
        """Expose the two specialist roles while keeping editor operations out of their tools."""
        @tool
        async def delegate_canvas_tasks(tasks: CanvasDelegationBatch) -> str:
            """Delegate to storyboard-design or footage-continuity-review. Assign card IDs and explicit prerequisites."""
            return json.dumps([result.model_dump(mode='json') for result in await self.run(tasks)], ensure_ascii=False)
        delegate_canvas_tasks.handle_tool_error = True
        delegate_canvas_tasks.handle_validation_error = True
        return delegate_canvas_tasks

    async def run(self, tasks):
        """Run independent specialists concurrently and hold tasks with failed prerequisites."""
        pending = {item.id: item for item in tasks}
        if (len(tasks) != len(pending) or any(set(task.depends_on) - pending.keys() for task in tasks)
                or any(set(task.card_ids) - self._cards.keys() for task in tasks)):
            raise ToolException('Delegated tasks must have distinct IDs, known prerequisites, and in-scope cards')
        schedule = self._schedule(pending)
        async with self._batch_lock:
            if len(self.results.keys() | pending.keys()) > 4:
                raise ToolException('A turn can use at most four specialist tasks')
            for wave in schedule:
                await asyncio.gather(*(self._execute(pending[identity]) for identity in wave))
            return [self.results[item.id] for item in tasks]

    @staticmethod
    def _schedule(pending):
        remaining = dict(pending)
        waves = []
        while remaining:
            wave = [key for key, task in remaining.items() if not set(task.depends_on) & remaining.keys()]
            if not wave:
                raise ToolException('Delegated task prerequisites cannot form a cycle')
            waves.append(wave)
            for key in wave:
                remaining.pop(key)
        return waves

    async def _execute(self, task):
        prerequisites = [self.results[key] for key in task.depends_on]
        digest = CanvasStore.command_digest({'task': task.model_dump(), 'requires': [item.result for item in prerequisites]})
        if task.id in self._completed:
            if self._completed[task.id]['digest'] != digest:
                raise ToolException('Reuse a specialist task ID only for the original scope')
            return
        result = CanvasAssistantSubtask(id=task.id, task=task.task, role=task.role, card_ids=task.card_ids,
                                      model_id=self._model_id, status='blocked', skills=[], evidence=[],
                                      result='依赖的素材审看或分镜任务尚未成功')
        if all(item.status == 'completed' for item in prerequisites):
            if self._checkpoint:
                await self._checkpoint.report_progress(started_task=(task.id, task.task))
            await self._consult(result, prerequisites)
        record = {'digest': digest, 'result': result.model_dump(mode='json')}
        if self._checkpoint:
            await self._checkpoint.save_delegation(task.id, record)
            await self._checkpoint.report_progress(finished_task=record['result'])
        self._completed[task.id] = record
        self.results[task.id] = result

    async def _consult(self, result, prerequisites):
        skills = [skill_catalog()[skill_id] for skill_id in _ROLE_SKILLS[result.role]]
        restrictions = '按实际提供的资料给出依据和候选建议。分清没有读取的材料。不得写入画布、审批、提交生成或继续委派。'
        system = '\n'.join([restrictions, *(skill.instructions() for skill in skills)])
        payload = json.dumps({
            '任务': result.task, '卡片': [self._cards[key] for key in result.card_ids],
            '前置结果': [item.result for item in prerequisites],
        }, ensure_ascii=False)
        result.skills = [item.receipt() for item in skills]
        if len(payload) > 16000:
            result.status, result.result = 'failed', '所选卡片超出专项任务读取上限'
            return
        media = self._content if result.role == 'footage-continuity-review' and isinstance(self._content, list) else None
        try:
            async with asyncio.timeout(20):
                agent = create_deep_agent(model=self._client, tools=[], middleware=[review_without_tools], system_prompt=system)
                message = HumanMessage(content=[{'type': 'text', 'text': payload}, *media] if media else payload)
                answer = await agent.ainvoke({'messages': [message]})
            text = answer['messages'][-1].text.strip()
            if not text:
                raise ValueError('Empty specialist result')
            result.status, result.result = 'completed', text[:6000]
            if media:
                result.evidence = [CanvasAssistantAttachment.model_validate(item) for item in self._attachments]
        except Exception:  # pylint: disable=broad-exception-caught
            result.status, result.result = 'failed', '专项模型未返回可核对的结果'
