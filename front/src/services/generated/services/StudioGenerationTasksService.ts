/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_ExperimentTaskCreated_ } from '../models/ApiResponse_ExperimentTaskCreated_';
import type { ApiResponse_TaskCreated_ } from '../models/ApiResponse_TaskCreated_';
import type { GenerationSubmitRequest_Input } from '../models/GenerationSubmitRequest_Input';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioGenerationTasksService {
    /**
     * 提交演员图片任务
     * 绑定演员图片槽位，防止请求体伪造目标或改变图片执行语义。
     * @returns ApiResponse_TaskCreated_ Successful Response
     * @throws ApiError
     */
    public static submitActorImageGenerationTaskApiV1StudioGenerationTasksActorsActorIdSlotsSlotIdTasksPost({
        actorId,
        slotId,
        requestBody,
    }: {
        actorId: string,
        slotId: number,
        requestBody: GenerationSubmitRequest_Input,
    }): CancelablePromise<ApiResponse_TaskCreated_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-tasks/actors/{actor_id}/slots/{slot_id}/tasks',
            path: {
                'actor_id': actorId,
                'slot_id': slotId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 提交角色图片任务
     * 绑定角色图片槽位，统一交由提交器冻结模型与媒体快照。
     * @returns ApiResponse_TaskCreated_ Successful Response
     * @throws ApiError
     */
    public static submitCharacterImageGenerationTaskApiV1StudioGenerationTasksCharactersCharacterIdSlotsSlotIdTasksPost({
        characterId,
        slotId,
        requestBody,
    }: {
        characterId: string,
        slotId: number,
        requestBody: GenerationSubmitRequest_Input,
    }): CancelablePromise<ApiResponse_TaskCreated_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-tasks/characters/{character_id}/slots/{slot_id}/tasks',
            path: {
                'character_id': characterId,
                'slot_id': slotId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 提交资产图片任务
     * 绑定道具、场景或服装图片槽位；资产类型仅用于受限路径匹配。
     * @returns ApiResponse_TaskCreated_ Successful Response
     * @throws ApiError
     */
    public static submitAssetImageGenerationTaskApiV1StudioGenerationTasksAssetsAssetTypeAssetIdSlotsSlotIdTasksPost({
        assetType,
        assetId,
        slotId,
        requestBody,
    }: {
        assetType: 'prop' | 'scene' | 'costume',
        assetId: string,
        slotId: number,
        requestBody: GenerationSubmitRequest_Input,
    }): CancelablePromise<ApiResponse_TaskCreated_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-tasks/assets/{asset_type}/{asset_id}/slots/{slot_id}/tasks',
            path: {
                'asset_type': assetType,
                'asset_id': assetId,
                'slot_id': slotId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 提交图片实验室统一任务
     * 为图片实验会话创建权威消息和安全快照任务。
     * @returns ApiResponse_ExperimentTaskCreated_ Successful Response
     * @throws ApiError
     */
    public static submitImageLabGenerationTaskApiV1StudioGenerationTasksLabsImageSessionsSessionIdTasksPost({
        sessionId,
        requestBody,
    }: {
        sessionId: string,
        requestBody: GenerationSubmitRequest_Input,
    }): CancelablePromise<ApiResponse_ExperimentTaskCreated_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-tasks/labs/image/sessions/{session_id}/tasks',
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
     * 提交视频实验室统一任务
     * 为视频实验会话创建权威消息和安全快照任务。
     * @returns ApiResponse_ExperimentTaskCreated_ Successful Response
     * @throws ApiError
     */
    public static submitVideoLabGenerationTaskApiV1StudioGenerationTasksLabsVideoSessionsSessionIdTasksPost({
        sessionId,
        requestBody,
    }: {
        sessionId: string,
        requestBody: GenerationSubmitRequest_Input,
    }): CancelablePromise<ApiResponse_ExperimentTaskCreated_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-tasks/labs/video/sessions/{session_id}/tasks',
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
}
