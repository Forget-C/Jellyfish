/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_ExperimentMessageRead_ } from '../models/ApiResponse_ExperimentMessageRead_';
import type { ApiResponse_ExperimentSessionRead_ } from '../models/ApiResponse_ExperimentSessionRead_';
import type { ApiResponse_list_ExperimentMessageRead__ } from '../models/ApiResponse_list_ExperimentMessageRead__';
import type { ApiResponse_list_ExperimentSessionRead__ } from '../models/ApiResponse_list_ExperimentSessionRead__';
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { ExperimentMessageCreate } from '../models/ExperimentMessageCreate';
import type { ExperimentMessageUpdate } from '../models/ExperimentMessageUpdate';
import type { ExperimentSessionCreate } from '../models/ExperimentSessionCreate';
import type { ExperimentSessionUpdate } from '../models/ExperimentSessionUpdate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioExperimentSessionsService {
    /**
     * Create Experiment Session
     * 创建仅用于展示历史的新实验会话。
     * @returns ApiResponse_ExperimentSessionRead_ Successful Response
     * @throws ApiError
     */
    public static createExperimentSessionApiV1StudioExperimentSessionsPost({
        requestBody,
    }: {
        requestBody: ExperimentSessionCreate,
    }): CancelablePromise<ApiResponse_ExperimentSessionRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/experiment-sessions',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * List Experiment Sessions
     * 按实验室类型读取最近更新的会话列表。
     * @returns ApiResponse_list_ExperimentSessionRead__ Successful Response
     * @throws ApiError
     */
    public static listExperimentSessionsApiV1StudioExperimentSessionsGet({
        labType,
    }: {
        labType: 'text' | 'image' | 'video',
    }): CancelablePromise<ApiResponse_list_ExperimentSessionRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/experiment-sessions',
            query: {
                'lab_type': labType,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Update Experiment Session
     * 更新会话标题。
     * @returns ApiResponse_ExperimentSessionRead_ Successful Response
     * @throws ApiError
     */
    public static updateExperimentSessionApiV1StudioExperimentSessionsSessionIdPatch({
        sessionId,
        requestBody,
    }: {
        sessionId: string,
        requestBody: ExperimentSessionUpdate,
    }): CancelablePromise<ApiResponse_ExperimentSessionRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/experiment-sessions/{session_id}',
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
     * Delete Experiment Session
     * 删除尚未关联任务消息的会话，避免运行任务失去历史归属。
     *
     * P2 接入审计后，应在提交成功的同一事务中记录删除事件。
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteExperimentSessionApiV1StudioExperimentSessionsSessionIdDelete({
        sessionId,
    }: {
        sessionId: string,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/experiment-sessions/{session_id}',
            path: {
                'session_id': sessionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * List Experiment Messages
     * 分页读取一个会话的用户可见消息历史。
     * @returns ApiResponse_list_ExperimentMessageRead__ Successful Response
     * @throws ApiError
     */
    public static listExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesGet({
        sessionId,
        page = 1,
        pageSize = 50,
    }: {
        sessionId: string,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_list_ExperimentMessageRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/experiment-sessions/{session_id}/messages',
            path: {
                'session_id': sessionId,
            },
            query: {
                'page': page,
                'page_size': pageSize,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Experiment Message
     * 追加一条用户可见消息；该数据不会传入模型上下文。
     * @returns ApiResponse_ExperimentMessageRead_ Successful Response
     * @throws ApiError
     */
    public static createExperimentMessageApiV1StudioExperimentSessionsSessionIdMessagesPost({
        sessionId,
        requestBody,
    }: {
        sessionId: string,
        requestBody: ExperimentMessageCreate,
    }): CancelablePromise<ApiResponse_ExperimentMessageRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/experiment-sessions/{session_id}/messages',
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
     * Clear Experiment Messages
     * 清空不含生成任务的会话历史，避免运行任务失去展示归属。
     *
     * P2 的保留策略落地前维持物理删除；后续归档策略不能影响运行中任务保护。
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static clearExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesDelete({
        sessionId,
    }: {
        sessionId: string,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/experiment-sessions/{session_id}/messages',
            path: {
                'session_id': sessionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Update Experiment Message
     * 更新异步任务消息的状态、展示文本或结果快照。
     * @returns ApiResponse_ExperimentMessageRead_ Successful Response
     * @throws ApiError
     */
    public static updateExperimentMessageApiV1StudioExperimentSessionsMessagesMessageIdPatch({
        messageId,
        requestBody,
    }: {
        messageId: string,
        requestBody: ExperimentMessageUpdate,
    }): CancelablePromise<ApiResponse_ExperimentMessageRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/experiment-sessions/messages/{message_id}',
            path: {
                'message_id': messageId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
