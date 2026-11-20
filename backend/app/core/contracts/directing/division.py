"""整章划分的完整基线、身份去向和显式影响确认契约。"""

from typing import Literal

from pydantic import Field, model_validator

from app.core.contracts.directing.common import Contract, Identity, Text
from app.core.contracts.directing.workspace import ChapterSequences, SequenceRead, SourceSpan


class DivisionBaseline(Contract):
    """编辑开始时的每个当前成员；服务端比较完整集合，不只比较保留项。"""

    sequence_id: Identity
    version: int = Field(gt=0)


class DivisionMember(Contract):
    """最终顺序由列表位置决定；key 在草稿及响应丢失重试期间保持稳定。"""

    key: Identity
    sequence_id: Identity | None = None
    title: Text = Field(max_length=255)
    span: SourceSpan
    reconfirm_source: bool = False


class DivisionLineage(Contract):
    """用户指定旧身份的去向；空 targets 表示移出，多个表示拆分。"""

    sequence_id: Identity
    target_keys: list[Identity]


class DivisionDraft(Contract):
    """最终整章方案；遗漏不等于退出，所有旧身份必须保留或明确退出。"""

    source_version: Text
    source_basis_id: Identity | None = None
    source_task_id: Identity | None = None
    source_revision_id: Identity | None = None
    restored_baseline: list[DivisionBaseline] = Field(default_factory=list)
    history_reconfirmed: bool = False
    baseline: list[DivisionBaseline]
    members: list[DivisionMember]
    exited_sequence_ids: list[Identity]
    lineage: list[DivisionLineage]

    @model_validator(mode="after")
    def identities(self):
        """拒绝重复、悬空身份和隐式丢弃；拆分/合并由显式映射表达。"""
        baseline = [row.sequence_id for row in self.baseline]
        keys = [row.key for row in self.members]
        retained = [row.sequence_id for row in self.members if row.sequence_id is not None]
        origins = [row.sequence_id for row in self.lineage]
        restored = [row.sequence_id for row in self.restored_baseline]
        if self.source_revision_id is not None and self.source_task_id is not None:
            raise ValueError("一次载入只能指定历史版本或分析任务中的一种来源")
        for values in (baseline, keys, retained, self.exited_sequence_ids, origins, restored):
            if len(values) != len(set(values)):
                raise ValueError("划分方案不能包含重复身份")
        if set(retained) & set(self.exited_sequence_ids):
            raise ValueError("场次不能同时保留和退出")
        if restored and self.source_revision_id is None:
            raise ValueError("恢复身份必须指定来源历史版本")
        if set(restored) & set(baseline) or not set(restored) <= set(retained):
            raise ValueError("恢复身份必须是最终成员且不能属于当前基线")
        if self.history_reconfirmed and self.source_revision_id is None and self.source_task_id is None:
            raise ValueError("历史核对必须保留来源记录")
        if set(baseline) != (set(retained) - set(restored)) | set(self.exited_sequence_ids):
            raise ValueError("必须明确保留或退出全部基线场次")
        if set(origins) != set(baseline):
            raise ValueError("必须确认全部旧场次的身份去向")
        for row in self.lineage:
            if len(row.target_keys) != len(set(row.target_keys)) or not set(row.target_keys) <= set(keys):
                raise ValueError("身份去向包含重复或未知目标")
            survivor = next((member for member in self.members if member.sequence_id == row.sequence_id), None)
            if survivor is not None and survivor.key not in row.target_keys:
                raise ValueError("保留场次必须包含其自身身份去向")
        return self


class DivisionImpact(Contract):
    """逐场展示真实差异与保留的成果，不把范围变化表达为自动重制。"""

    key: Identity
    before: SequenceRead | None
    after: DivisionMember | None
    changes: list[Literal["added", "title", "position", "range", "source", "exited", "restored"]]
    design_count: int = Field(ge=0)
    plan_count: int = Field(ge=0)
    take_count: int = Field(ge=0)
    cut_count: int = Field(ge=0)
    active_cut_revision_id: Identity | None


class DivisionPreview(Contract):
    """预览依据绑定完整草稿及实时影响；阻塞存在时不能保存。"""

    preview_token: Text
    impacts: list[DivisionImpact]
    blockers: list[Text]
    unassigned_character_count: int = Field(ge=0)
    identity_confirmation_required: bool


class DivisionSave(Contract):
    """同 request_id 与同内容可安全重试；不同内容复用身份必须冲突。"""

    request_id: Identity
    draft: DivisionDraft
    preview_token: Text
    identity_changes_confirmed: bool = False


class DivisionSaved(Contract):
    """提交时的完整快照和新建映射；恢复响应不重复创建或再次更新。"""

    request_id: Identity
    chapter: ChapterSequences
    created_sequence_ids: dict[Identity, Identity]
    impacts: list[DivisionImpact]
