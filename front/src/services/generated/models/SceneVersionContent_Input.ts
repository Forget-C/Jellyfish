/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableGenerationUnit_Input } from './EditableGenerationUnit_Input';
import type { EditableSceneDesign_Input } from './EditableSceneDesign_Input';
import type { SceneTakeJudgment_Input } from './SceneTakeJudgment_Input';
import type { SceneTimeline_Input } from './SceneTimeline_Input';
import type { SceneVersionSource_Input } from './SceneVersionSource_Input';
/**
 * 四画布共用的可编辑内容；按已交付能力扩展强类型字段。
 */
export type SceneVersionContent_Input = {
    basis: SceneVersionSource_Input;
    design: EditableSceneDesign_Input;
    output_aspect_ratio?: '16:9' | '9:16' | '1:1';
    units?: Array<EditableGenerationUnit_Input>;
    take_judgments?: Array<SceneTakeJudgment_Input>;
    timeline?: SceneTimeline_Input;
};
