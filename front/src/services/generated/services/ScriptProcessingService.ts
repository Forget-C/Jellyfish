/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_AsyncTaskCreateRead_ } from '../models/ApiResponse_AsyncTaskCreateRead_';
import type { CharacterPortraitAnalysisRequest } from '../models/CharacterPortraitAnalysisRequest';
import type { CostumeInfoAnalysisRequest } from '../models/CostumeInfoAnalysisRequest';
import type { PropInfoAnalysisRequest } from '../models/PropInfoAnalysisRequest';
import type { SceneInfoAnalysisRequest } from '../models/SceneInfoAnalysisRequest';
import type { ScriptConsistencyCheckRequest } from '../models/ScriptConsistencyCheckRequest';
import type { ScriptOptimizeRequest } from '../models/ScriptOptimizeRequest';
import type { ScriptSimplifyRequest } from '../models/ScriptSimplifyRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ScriptProcessingService {
    /**
     * 异步检查角色混淆一致性（基于原文）
     * 创建一致性检查任务并立即返回 task_id；前端可通过任务状态接口轮询。
     * @returns ApiResponse_AsyncTaskCreateRead_ Successful Response
     * @throws ApiError
     */
    public static checkConsistencyAsyncApiV1ScriptProcessingCheckConsistencyAsyncPost({
        requestBody,
    }: {
        requestBody: ScriptConsistencyCheckRequest,
    }): CancelablePromise<ApiResponse_AsyncTaskCreateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/check-consistency-async',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 异步分析人物画像缺失信息
     * 创建人物画像分析任务并立即返回 task_id；前端可通过任务状态接口轮询。
     * @returns ApiResponse_AsyncTaskCreateRead_ Successful Response
     * @throws ApiError
     */
    public static analyzeCharacterPortraitAsyncApiV1ScriptProcessingAnalyzeCharacterPortraitAsyncPost({
        requestBody,
    }: {
        requestBody: CharacterPortraitAnalysisRequest,
    }): CancelablePromise<ApiResponse_AsyncTaskCreateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/analyze-character-portrait-async',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 异步分析道具信息缺失项
     * 创建道具信息分析任务并立即返回 task_id；前端可通过任务状态接口轮询。
     * @returns ApiResponse_AsyncTaskCreateRead_ Successful Response
     * @throws ApiError
     */
    public static analyzePropInfoAsyncApiV1ScriptProcessingAnalyzePropInfoAsyncPost({
        requestBody,
    }: {
        requestBody: PropInfoAnalysisRequest,
    }): CancelablePromise<ApiResponse_AsyncTaskCreateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/analyze-prop-info-async',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 异步分析场景信息缺失项
     * 创建场景信息分析任务并立即返回 task_id；前端可通过任务状态接口轮询。
     * @returns ApiResponse_AsyncTaskCreateRead_ Successful Response
     * @throws ApiError
     */
    public static analyzeSceneInfoAsyncApiV1ScriptProcessingAnalyzeSceneInfoAsyncPost({
        requestBody,
    }: {
        requestBody: SceneInfoAnalysisRequest,
    }): CancelablePromise<ApiResponse_AsyncTaskCreateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/analyze-scene-info-async',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 异步分析服装信息缺失项
     * 创建服装信息分析任务并立即返回 task_id；前端可通过任务状态接口轮询。
     * @returns ApiResponse_AsyncTaskCreateRead_ Successful Response
     * @throws ApiError
     */
    public static analyzeCostumeInfoAsyncApiV1ScriptProcessingAnalyzeCostumeInfoAsyncPost({
        requestBody,
    }: {
        requestBody: CostumeInfoAnalysisRequest,
    }): CancelablePromise<ApiResponse_AsyncTaskCreateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/analyze-costume-info-async',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 异步基于一致性检查优化剧本
     * 创建剧本优化任务并立即返回 task_id；前端可通过任务状态接口轮询。
     * @returns ApiResponse_AsyncTaskCreateRead_ Successful Response
     * @throws ApiError
     */
    public static optimizeScriptAsyncApiV1ScriptProcessingOptimizeScriptAsyncPost({
        requestBody,
    }: {
        requestBody: ScriptOptimizeRequest,
    }): CancelablePromise<ApiResponse_AsyncTaskCreateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/optimize-script-async',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 异步智能精简剧本
     * 创建剧本精简任务并立即返回 task_id；前端可通过任务状态接口轮询。
     * @returns ApiResponse_AsyncTaskCreateRead_ Successful Response
     * @throws ApiError
     */
    public static simplifyScriptAsyncApiV1ScriptProcessingSimplifyScriptAsyncPost({
        requestBody,
    }: {
        requestBody: ScriptSimplifyRequest,
    }): CancelablePromise<ApiResponse_AsyncTaskCreateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/simplify-script-async',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
