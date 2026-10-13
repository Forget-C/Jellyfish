/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableGenerationUnit_Output } from './EditableGenerationUnit_Output';
import type { EditableSceneDesign_Output } from './EditableSceneDesign_Output';
import type { SceneTakeJudgment_Output } from './SceneTakeJudgment_Output';
import type { SceneTimeline_Output } from './SceneTimeline_Output';
import type { SceneVersionSource_Output } from './SceneVersionSource_Output';
/**
 * 四画布共用的可编辑内容；按已交付能力扩展强类型字段。
 */
export type SceneVersionContent_Output = {
    basis: SceneVersionSource_Output;
    design: EditableSceneDesign_Output;
    output_aspect_ratio: '16:9' | '9:16' | '1:1';
    units: Array<EditableGenerationUnit_Output>;
    take_judgments: Array<SceneTakeJudgment_Output>;
    timeline: SceneTimeline_Output;
};
