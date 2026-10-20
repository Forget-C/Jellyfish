/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignScopeIssue } from './DesignScopeIssue';
import type { EditableSceneDesign_Output } from './EditableSceneDesign_Output';
import type { SceneDesignDiagnostics } from './SceneDesignDiagnostics';
import type { SceneVersionSource_Output } from './SceneVersionSource_Output';
/**
 * 建议任务的版本归属、固定输入与结果；运行中不伪装成空设计。
 */
export type SceneDesignSuggestionRead = {
    task_id: string;
    scope: (Array<string> | null);
    request_id: string;
    created_at: string;
    status: string;
    error: (string | null);
    instruction: string;
    basis: SceneVersionSource_Output;
    before: EditableSceneDesign_Output;
    design: (EditableSceneDesign_Output | null);
    diagnostics?: (SceneDesignDiagnostics | null);
    issues?: Array<DesignScopeIssue>;
    candidate_attempt?: (number | null);
};
