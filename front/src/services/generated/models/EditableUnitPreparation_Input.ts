/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableCoverageItem_Input } from './EditableCoverageItem_Input';
import type { ModelCapability_Input } from './ModelCapability_Input';
import type { ReferenceBinding_Input } from './ReferenceBinding_Input';
import type { SceneFrameDependency } from './SceneFrameDependency';
import type { UnitDependency } from './UnitDependency';
/**
 * 准备中的单元可缺模型或时长，执行前另做准备度与模型能力检查。
 */
export type EditableUnitPreparation_Input = {
    id: string;
    coverage: Array<EditableCoverageItem_Input>;
    references?: Array<ReferenceBinding_Input>;
    model_id?: (string | null);
    duration_ms?: (number | null);
    ratio: string;
    parameters?: Record<string, (string | number | boolean | null)>;
    capability?: ModelCapability_Input;
    dependencies?: Array<UnitDependency>;
    scene_dependencies?: Array<SceneFrameDependency>;
};
