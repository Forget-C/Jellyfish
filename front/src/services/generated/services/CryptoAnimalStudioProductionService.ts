/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_list_ProductionArtifactView__ } from '../models/ApiResponse_list_ProductionArtifactView__';
import type { ApiResponse_ProductionJobView_ } from '../models/ApiResponse_ProductionJobView_';
import type { CreateProductionJobRequest } from '../models/CreateProductionJobRequest';
import type { RetryProductionJobRequest } from '../models/RetryProductionJobRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class CryptoAnimalStudioProductionService {
    /**
     * Create Production Job
     * 创建并同步执行一次生产（每次调用创建新任务）。
     * @returns ApiResponse_ProductionJobView_ Successful Response
     * @throws ApiError
     */
    public static createProductionJobApiV1CryptoAnimalStudioProductionJobsPost({
        requestBody,
    }: {
        requestBody: CreateProductionJobRequest,
    }): CancelablePromise<ApiResponse_ProductionJobView_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/crypto-animal-studio/production/jobs',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Production Job
     * 查询生产任务状态。
     * @returns ApiResponse_ProductionJobView_ Successful Response
     * @throws ApiError
     */
    public static getProductionJobApiV1CryptoAnimalStudioProductionJobsJobIdGet({
        jobId,
    }: {
        jobId: string,
    }): CancelablePromise<ApiResponse_ProductionJobView_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/crypto-animal-studio/production/jobs/{job_id}',
            path: {
                'job_id': jobId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * List Production Artifacts
     * 列出任务的全部产物。
     * @returns ApiResponse_list_ProductionArtifactView__ Successful Response
     * @throws ApiError
     */
    public static listProductionArtifactsApiV1CryptoAnimalStudioProductionJobsJobIdArtifactsGet({
        jobId,
    }: {
        jobId: string,
    }): CancelablePromise<ApiResponse_list_ProductionArtifactView__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/crypto-animal-studio/production/jobs/{job_id}/artifacts',
            path: {
                'job_id': jobId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Retry Production Job
     * 从失败阶段重试（复用更早的有效产物）。
     * @returns ApiResponse_ProductionJobView_ Successful Response
     * @throws ApiError
     */
    public static retryProductionJobApiV1CryptoAnimalStudioProductionJobsJobIdRetryPost({
        jobId,
        requestBody,
    }: {
        jobId: string,
        requestBody: RetryProductionJobRequest,
    }): CancelablePromise<ApiResponse_ProductionJobView_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/crypto-animal-studio/production/jobs/{job_id}/retry',
            path: {
                'job_id': jobId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
