/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableSceneDesign_Output } from './EditableSceneDesign_Output';
import type { SceneVersionSource_Output } from './SceneVersionSource_Output';
/**
 * 已核实的整场建议与真实固定依据，仅供用户预览和明确应用。
 */
export type SceneDesignPreview = {
    task_id: string;
    scope: (Array<string> | null);
    basis: SceneVersionSource_Output;
    before: EditableSceneDesign_Output;
    design: EditableSceneDesign_Output;
};
