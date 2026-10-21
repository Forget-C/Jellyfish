/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableCoverageItem_Output } from './EditableCoverageItem_Output';
import type { ModelCapability_Output } from './ModelCapability_Output';
import type { ReferenceBinding_Output } from './ReferenceBinding_Output';
import type { SceneFrameDependency } from './SceneFrameDependency';
import type { Source } from './Source';
import type { UnitDependency } from './UnitDependency';
import type { UnitOrganization_Output } from './UnitOrganization_Output';
/**
 * 正文与依据确认分别保存，普通编辑不自动确认新依据。
 */
export type EditableGenerationUnit_Output = {
    id: string;
    coverage: Array<EditableCoverageItem_Output>;
    references: Array<ReferenceBinding_Output>;
    model_id: (string | null);
    duration_ms: (number | null);
    ratio: string;
    parameters: Record<string, (string | number | boolean | null)>;
    capability: ModelCapability_Output;
    dependencies: Array<UnitDependency>;
    organization: (UnitOrganization_Output | null);
    scene_dependencies: Array<SceneFrameDependency>;
    instruction_basis_id: (string | null);
    instruction_check_task_id: (string | null);
    /**
     * 当前单元的可编辑指令正文；保存不代表检查通过或授权生成。
     */
    instruction: string;
    /**
     * 当前正文的人工或真实任务来源；正文改写时同步更新。
     */
    instruction_source: (Source | null);
};
