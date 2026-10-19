/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableGenerationUnit_Output } from './EditableGenerationUnit_Output';
import type { EditableSceneDesign_Output } from './EditableSceneDesign_Output';
import type { SceneInstructionScope } from './SceneInstructionScope';
import type { SceneVersionSource_Output } from './SceneVersionSource_Output';
import type { StyleRule_Output } from './StyleRule_Output';
import type { UnitScopeProjection_Output } from './UnitScopeProjection_Output';
/**
 * 任务真实状态与固定输入；没有结果时正文为空，不伪造空建议。
 */
export type SceneInstructionSuggestionRead = {
    task_id: string;
    request_id: string;
    status: string;
    error: (string | null);
    requirements: string;
    scope?: (SceneInstructionScope | null);
    unit_scope?: (UnitScopeProjection_Output | null);
    basis: SceneVersionSource_Output;
    design: EditableSceneDesign_Output;
    unit: EditableGenerationUnit_Output;
    generation_model_id: (string | null);
    generation_model_name: (string | null);
    video_model_name: (string | null);
    style_rules: (Array<StyleRule_Output> | null);
    text: (string | null);
};
