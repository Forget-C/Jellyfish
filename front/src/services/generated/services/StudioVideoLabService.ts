/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_ExperimentTaskCreated_ } from '../models/ApiResponse_ExperimentTaskCreated_';
import type { VideoLabGenerateRequest } from '../models/VideoLabGenerateRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioVideoLabService {
    /**
     * 创建独立视频实验任务
     * 创建不绑定镜头的视频任务，并把生成结果归档到全局资料库。
     * @returns ApiResponse_ExperimentTaskCreated_ Successful Response
     * @throws ApiError
     */
    public static createVideoLabTaskApiV1StudioVideoLabTasksPost({
        requestBody,
    }: {
        requestBody: VideoLabGenerateRequest,
    }): CancelablePromise<ApiResponse_ExperimentTaskCreated_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/video-lab/tasks',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
