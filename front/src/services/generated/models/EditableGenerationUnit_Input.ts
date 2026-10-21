/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableCoverageItem_Input } from './EditableCoverageItem_Input';
import type { ModelCapability_Input } from './ModelCapability_Input';
import type { ReferenceBinding_Input } from './ReferenceBinding_Input';
import type { SceneFrameDependency } from './SceneFrameDependency';
import type { Source } from './Source';
import type { UnitDependency } from './UnitDependency';
import type { UnitOrganization_Input } from './UnitOrganization_Input';
/**
 * 正文与依据确认分别保存，普通编辑不自动确认新依据。
 */
export type EditableGenerationUnit_Input = {
    id: string;
    coverage: Array<EditableCoverageItem_Input>;
    references?: Array<ReferenceBinding_Input>;
    model_id?: (string | null);
    duration_ms?: (number | null);
    ratio: string;
    parameters?: Record<string, (string | number | boolean | null)>;
    capability?: ModelCapability_Input;
    dependencies?: Array<UnitDependency>;
    organization?: (UnitOrganization_Input | null);
    scene_dependencies?: Array<SceneFrameDependency>;
    instruction_basis_id?: (string | null);
    instruction_check_task_id?: (string | null);
    /**
     * 当前单元的可编辑指令正文；保存不代表检查通过或授权生成。
     */
    instruction?: string;
    /**
     * 当前正文的人工或真实任务来源；正文改写时同步更新。
     */
    instruction_source?: (Source | null);
};
