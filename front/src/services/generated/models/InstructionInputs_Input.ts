/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableSceneDesign_Input } from './EditableSceneDesign_Input';
import type { EditableUnitPreparation_Input } from './EditableUnitPreparation_Input';
import type { SceneVersionSource_Input } from './SceneVersionSource_Input';
import type { StyleRule_Input } from './StyleRule_Input';
import type { UnitScopeProjection_Input } from './UnitScopeProjection_Input';
/**
 * 只包含相关依据，正文和来源单独记录，其他单元与输出画幅不参与比较。
 */
export type InstructionInputs_Input = {
    basis: SceneVersionSource_Input;
    design: EditableSceneDesign_Input;
    unit: EditableUnitPreparation_Input;
    video_model_name: (string | null);
    style_rules: Array<StyleRule_Input>;
    scope?: (UnitScopeProjection_Input | null);
};
