/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_TextLabGenerateResponse_ } from '../models/ApiResponse_TextLabGenerateResponse_';
import type { TextLabGenerateRequest } from '../models/TextLabGenerateRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioTextLabService {
    /**
     * 使用指定文本模型执行一轮实验对话
     * 执行单轮文本模型调用；会话持久化由客户端实验页面负责。
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
}
