/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableCoverageItem_Output } from './EditableCoverageItem_Output';
import type { ModelCapability_Output } from './ModelCapability_Output';
import type { ReferenceBinding_Output } from './ReferenceBinding_Output';
import type { SceneFrameDependency } from './SceneFrameDependency';
import type { UnitDependency } from './UnitDependency';
import type { UnitOrganization_Output } from './UnitOrganization_Output';
/**
 * 准备中的单元可缺模型或时长，执行前另做准备度与模型能力检查。
 */
export type EditableUnitPreparation_Output = {
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
};
