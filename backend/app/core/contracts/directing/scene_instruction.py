"""旧单元指令任务的历史结果。"""

from app.core.contracts.directing.common import Contract, Identity, Text


class SceneInstructionResult(Contract):
    """模型只能返回指定单元的正文，不能变更设计、引用或其他单元。"""

    unit_id: Identity
    text: Text
