/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneUnitDesignRequest_Output } from './SceneUnitDesignRequest_Output';
import type { SceneUnitDesignResult } from './SceneUnitDesignResult';
/**
 * 任务固定依据与类型化结果；未完成任务不伪装成空方案。
 */
export type SceneUnitDesignSuggestionRead = {
    task_id: string;
    request_id: string;
    created_at: string;
    status: string;
    error: (string | null);
    request: SceneUnitDesignRequest_Output;
    target_model_name: string;
    text_model_name: string;
    capabilities: Record<string, any>;
    result: (SceneUnitDesignResult | null);
};
