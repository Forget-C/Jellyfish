/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableSceneDesign } from './EditableSceneDesign';
import type { EditableUnitPreparation } from './EditableUnitPreparation';
import type { SceneVersionSource } from './SceneVersionSource';
import type { StyleRule_Output } from './StyleRule_Output';
import type { UnitScopeProjection } from './UnitScopeProjection';
/**
 * 只包含相关依据，正文和来源单独记录，其他单元与输出画幅不参与比较。
 */
export type InstructionInputs = {
    basis: SceneVersionSource;
    design: EditableSceneDesign;
    unit: EditableUnitPreparation;
    video_model_name: (string | null);
    style_rules: Array<StyleRule_Output>;
    scope?: (UnitScopeProjection | null);
};
