/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_TextLabGenerateResponse_ } from '../models/ApiResponse_TextLabGenerateResponse_';
import type { ApiResponse_TextLabRunStatus_ } from '../models/ApiResponse_TextLabRunStatus_';
import type { TextLabCancelRequest } from '../models/TextLabCancelRequest';
import type { TextLabGenerateRequest } from '../models/TextLabGenerateRequest';
import type { TextLabRunRequest } from '../models/TextLabRunRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioTextLabService {
    /**
     * 过渡期同步文本实验入口
     * 保留 D3 页面切流前的同步调用，避免阶段提交让既有实验室不可用。
     * @returns ApiResponse_TextLabGenerateResponse_ Successful Response
     * @throws ApiError
     */
    public static generateTextLabResponseApiV1StudioTextLabGeneratePost({
        requestBody,
    }: {
        requestBody: TextLabGenerateRequest,
    }): CancelablePromise<ApiResponse_TextLabGenerateResponse_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/text-lab/generate',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 以固定 SSE 协议执行文本实验会话
     * 提交 canonical user message 后持续输出本轮文本增量与唯一终态事件。
     * @returns any Successful Response
     * @throws ApiError
     */
    public static streamTextLabResponseApiV1StudioTextLabSessionsSessionIdStreamPost({
        sessionId,
        requestBody,
    }: {
        sessionId: string,
        requestBody: TextLabRunRequest,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/text-lab/sessions/{session_id}/stream',
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
    public static cancelTextLabStreamApiV1StudioTextLabSessionsSessionIdRunsTaskIdCancelPost({
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
            url: '/api/v1/studio/text-lab/sessions/{session_id}/runs/{task_id}/cancel',
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
    /**
     * 过渡期同步文本实验入口
     * 保留 D3 页面切流前的同步调用，避免阶段提交让既有实验室不可用。
     * @returns ApiResponse_TextLabGenerateResponse_ Successful Response
     * @throws ApiError
     */
    public static generateTextLabResponseApiV1StudioLabsTextGeneratePost({
        requestBody,
    }: {
        requestBody: TextLabGenerateRequest,
    }): CancelablePromise<ApiResponse_TextLabGenerateResponse_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/labs/text/generate',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
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
