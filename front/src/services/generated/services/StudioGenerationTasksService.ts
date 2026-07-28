/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
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
}
