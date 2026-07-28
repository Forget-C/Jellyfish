/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_TextLabRunStatus_ } from '../models/ApiResponse_TextLabRunStatus_';
import type { TextLabCancelRequest } from '../models/TextLabCancelRequest';
import type { TextLabRunRequest } from '../models/TextLabRunRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioTextLabService {
    /**
     * 以固定 SSE 协议执行文本实验会话
     * 提交 canonical user message 后持续输出本轮文本增量与唯一终态事件。
     * @returns any Successful Response
     * @throws ApiError
     */
    public static streamTextLabResponseApiV1StudioLabsTextSessionsSessionIdStreamPost({
        sessionId,
        requestBody,
    }: {
        sessionId: string,
        requestBody: TextLabRunRequest,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/labs/text/sessions/{session_id}/stream',
            path: {
                'session_id': sessionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 取消当前文本实验会话的隐藏流式运行
     * 会话绑定取消入口不复用任务中心取消 API，避免 hidden run 越权展示。
     * @returns ApiResponse_TextLabRunStatus_ Successful Response
     * @throws ApiError
     */
    public static cancelTextLabStreamApiV1StudioLabsTextSessionsSessionIdRunsTaskIdCancelPost({
        sessionId,
        taskId,
        requestBody,
    }: {
        sessionId: string,
        taskId: string,
        requestBody: TextLabCancelRequest,
    }): CancelablePromise<ApiResponse_TextLabRunStatus_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/labs/text/sessions/{session_id}/runs/{task_id}/cancel',
            path: {
                'session_id': sessionId,
                'task_id': taskId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
