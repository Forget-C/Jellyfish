/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_ExperimentTaskCreated_ } from '../models/ApiResponse_ExperimentTaskCreated_';
import type { ApiResponse_TaskCreated_ } from '../models/ApiResponse_TaskCreated_';
import type { GenerationSubmitRequest } from '../models/GenerationSubmitRequest';
import type { ShotFrameType } from '../models/ShotFrameType';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioGenerationTasksService {
    /**
     * 提交镜头分镜帧图片任务
     * 绑定镜头帧槽位后提交图片任务；最终提示词由客户端先经 render API 确认。
     * @returns ApiResponse_TaskCreated_ Successful Response
     * @throws ApiError
     */
    public static submitShotFrameGenerationTaskApiV1StudioGenerationTasksShotsShotIdFramesFrameTypePost({
        shotId,
        frameType,
        requestBody,
    }: {
        shotId: string,
        frameType: ShotFrameType,
        requestBody: GenerationSubmitRequest,
    }): CancelablePromise<ApiResponse_TaskCreated_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-tasks/shots/{shot_id}/frames/{frame_type}',
            path: {
                'shot_id': shotId,
                'frame_type': frameType,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 提交镜头视频任务
     * 绑定镜头后提交视频任务；视频帧与具名主体媒体的分组直接冻结到快照。
     * @returns ApiResponse_TaskCreated_ Successful Response
     * @throws ApiError
     */
    public static submitShotVideoGenerationTaskApiV1StudioGenerationTasksShotsShotIdVideoPost({
        shotId,
        requestBody,
    }: {
        shotId: string,
        requestBody: GenerationSubmitRequest,
    }): CancelablePromise<ApiResponse_TaskCreated_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-tasks/shots/{shot_id}/video',
            path: {
                'shot_id': shotId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
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
        requestBody: GenerationSubmitRequest,
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
        requestBody: GenerationSubmitRequest,
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
        requestBody: GenerationSubmitRequest,
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
        requestBody: GenerationSubmitRequest,
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
        requestBody: GenerationSubmitRequest,
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
