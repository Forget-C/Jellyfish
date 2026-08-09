/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_CasImportTaskAccepted_ } from '../models/ApiResponse_CasImportTaskAccepted_';
import type { ApiResponse_dict_ } from '../models/ApiResponse_dict_';
import type { ApiResponse_ImportResult_ } from '../models/ApiResponse_ImportResult_';
import type { ApiResponse_list_ProductionArtifactView__ } from '../models/ApiResponse_list_ProductionArtifactView__';
import type { ApiResponse_ProductionJobView_ } from '../models/ApiResponse_ProductionJobView_';
import type { CreateProductionJobRequest } from '../models/CreateProductionJobRequest';
import type { ImportEpisodeRequest } from '../models/ImportEpisodeRequest';
import type { RetryProductionJobRequest } from '../models/RetryProductionJobRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class CryptoAnimalStudioService {
    /**
     * Cas Health
     * 返回 CAS 模块健康状态与契约版本。
     *
     * 返回：
     * 统一 ``ApiResponse`` 壳，data 形如
     * ``{"service": "crypto-animal-studio", "status": "ok", "schema_version": "1.0"}``。
     * @returns ApiResponse_dict_ Successful Response
     * @throws ApiError
     */
    public static casHealthApiV1CryptoAnimalStudioHealthGet(): CancelablePromise<ApiResponse_dict_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/crypto-animal-studio/health',
        });
    }
    /**
     * Import Episode Endpoint
     * 导入一个 EpisodePackage 为一个 Jellyfish Chapter（含 Shots 等）。
     *
     * 返回：统一 ``ApiResponse``，data 为 ImportResult。
     * 错误：项目不存在→404；幂等冲突/重复导入→409；契约校验失败→422（由 pydantic）；
     * CAS QA 闸门失败→422（零写入）。
     * @returns ApiResponse_ImportResult_ Successful Response
     * @throws ApiError
     */
    public static importEpisodeEndpointApiV1CryptoAnimalStudioImportPost({
        requestBody,
    }: {
        requestBody: ImportEpisodeRequest,
    }): CancelablePromise<ApiResponse_ImportResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/crypto-animal-studio/import',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Import Episode Async Endpoint
     * 把导入登记为任务中心的 ``cas_import_episode_package`` 任务并立即返回。
     *
     * 请求体与同步端点完全一致（同一个 ``ImportEpisodeRequest``），因此契约校验行为不变。
     * 真正的导入由 ``run_cas_import_task`` 驱动，成功/失败通过既有任务状态查询接口获取。
     *
     * 返回：统一 ``ApiResponse``，data 为任务受理信息（``reused=true`` 表示复用活动任务）。
     * @returns ApiResponse_CasImportTaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static importEpisodeAsyncEndpointApiV1CryptoAnimalStudioImportAsyncPost({
        requestBody,
    }: {
        requestBody: ImportEpisodeRequest,
    }): CancelablePromise<ApiResponse_CasImportTaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/crypto-animal-studio/import/async',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
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
