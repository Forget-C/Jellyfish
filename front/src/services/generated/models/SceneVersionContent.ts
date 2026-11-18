/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableGenerationUnit } from './EditableGenerationUnit';
import type { EditableSceneDesign } from './EditableSceneDesign';
import type { SceneTakeJudgment } from './SceneTakeJudgment';
import type { SceneTimeline } from './SceneTimeline';
import type { SceneVersionSource } from './SceneVersionSource';
/**
 * 四画布共用的可编辑内容；按已交付能力扩展强类型字段。
 */
export type SceneVersionContent = {
    basis: SceneVersionSource;
    design: EditableSceneDesign;
    output_aspect_ratio: '16:9' | '9:16' | '1:1';
    units: Array<EditableGenerationUnit>;
    unit_design_task_id: (string | null);
    take_judgments: Array<SceneTakeJudgment>;
    timeline: SceneTimeline;
};
