/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_ExperimentTaskCreated_ } from '../models/ApiResponse_ExperimentTaskCreated_';
import type { ImageLabGenerateRequest } from '../models/ImageLabGenerateRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioImageLabService {
    /**
     * 创建独立图片实验任务
     * 创建不绑定业务资产的图片任务，并把生成结果归档到全局资料库。
     * @returns ApiResponse_ExperimentTaskCreated_ Successful Response
     * @throws ApiError
     */
    public static createImageLabTaskApiV1StudioImageLabTasksPost({
        requestBody,
    }: {
        requestBody: ImageLabGenerateRequest,
    }): CancelablePromise<ApiResponse_ExperimentTaskCreated_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/image-lab/tasks',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
