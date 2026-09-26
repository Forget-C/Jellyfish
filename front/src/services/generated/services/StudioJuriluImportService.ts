/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_JuriluApplyRead_ } from '../models/ApiResponse_JuriluApplyRead_';
import type { ApiResponse_JuriluPreviewRead_ } from '../models/ApiResponse_JuriluPreviewRead_';
import type { JuriluImportRequest } from '../models/JuriluImportRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioJuriluImportService {
    /**
     * 巨日禄导入预览（抓取 + 分组 + 配对，不写库）
     * @returns ApiResponse_JuriluPreviewRead_ Successful Response
     * @throws ApiError
     */
    public static previewJuriluImportApiV1StudioJuriluImportProjectIdPreviewPost({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: JuriluImportRequest,
    }): CancelablePromise<ApiResponse_JuriluPreviewRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/jurilu-import/{project_id}/preview',
            path: {
                'project_id': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 巨日禄导入提交（抓取 + 分组 + 配对 + 写库）
     * @returns ApiResponse_JuriluApplyRead_ Successful Response
     * @throws ApiError
     */
    public static applyJuriluImportApiV1StudioJuriluImportProjectIdApplyPost({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: JuriluImportRequest,
    }): CancelablePromise<ApiResponse_JuriluApplyRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/jurilu-import/{project_id}/apply',
            path: {
                'project_id': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
