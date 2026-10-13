/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableSceneDesign_Output } from './EditableSceneDesign_Output';
import type { EditableUnitPreparation_Output } from './EditableUnitPreparation_Output';
import type { SceneVersionSource_Output } from './SceneVersionSource_Output';
import type { StyleRule_Output } from './StyleRule_Output';
/**
 * 只包含相关依据，正文和来源单独记录，其他单元与输出画幅不参与比较。
 */
export type InstructionInputs_Output = {
    basis: SceneVersionSource_Output;
    design: EditableSceneDesign_Output;
    unit: EditableUnitPreparation_Output;
    video_model_name: (string | null);
    style_rules: Array<StyleRule_Output>;
};
