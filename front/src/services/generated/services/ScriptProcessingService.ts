/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_AsyncTaskCreateRead_ } from '../models/ApiResponse_AsyncTaskCreateRead_';
import type { ApiResponse_CharacterPortraitAnalysisResult_ } from '../models/ApiResponse_CharacterPortraitAnalysisResult_';
import type { ApiResponse_CostumeInfoAnalysisResult_ } from '../models/ApiResponse_CostumeInfoAnalysisResult_';
import type { ApiResponse_EntityMergeResult_ } from '../models/ApiResponse_EntityMergeResult_';
import type { ApiResponse_PropInfoAnalysisResult_ } from '../models/ApiResponse_PropInfoAnalysisResult_';
import type { ApiResponse_SceneInfoAnalysisResult_ } from '../models/ApiResponse_SceneInfoAnalysisResult_';
import type { ApiResponse_ScriptConsistencyCheckResult_ } from '../models/ApiResponse_ScriptConsistencyCheckResult_';
import type { ApiResponse_ScriptDivisionResult_ } from '../models/ApiResponse_ScriptDivisionResult_';
import type { ApiResponse_StudioScriptExtractionDraft_ } from '../models/ApiResponse_StudioScriptExtractionDraft_';
import type { ApiResponse_VariantAnalysisResult_ } from '../models/ApiResponse_VariantAnalysisResult_';
import type { CharacterPortraitAnalysisRequest } from '../models/CharacterPortraitAnalysisRequest';
import type { CostumeInfoAnalysisRequest } from '../models/CostumeInfoAnalysisRequest';
import type { EntityMergerRequest } from '../models/EntityMergerRequest';
import type { PropInfoAnalysisRequest } from '../models/PropInfoAnalysisRequest';
import type { SceneInfoAnalysisRequest } from '../models/SceneInfoAnalysisRequest';
import type { ScriptConsistencyCheckRequest } from '../models/ScriptConsistencyCheckRequest';
import type { ScriptDividerRequest } from '../models/ScriptDividerRequest';
import type { ScriptExtractRequest } from '../models/ScriptExtractRequest';
import type { ScriptOptimizeRequest } from '../models/ScriptOptimizeRequest';
import type { ScriptSimplifyRequest } from '../models/ScriptSimplifyRequest';
import type { VariantAnalysisRequest } from '../models/VariantAnalysisRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ScriptProcessingService {
    /**
     * 异步将剧本分割为多个镜头
     * 创建章节分镜提取任务并立即返回 task_id；前端可通过任务状态接口轮询。
     * @returns ApiResponse_AsyncTaskCreateRead_ Successful Response
     * @throws ApiError
     */
    public static divideScriptAsyncApiV1ScriptProcessingDivideAsyncPost({
        requestBody,
    }: {
        requestBody: ScriptDividerRequest,
    }): CancelablePromise<ApiResponse_AsyncTaskCreateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/divide-async',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 将剧本分割为多个镜头
     * 输入完整剧本文本，输出分镜列表（index/start_line/end_line/script_excerpt/shot_name/time_of_day）。注意：此阶段不强制稳定ID，角色以“称呼/名字”弱信息输出，稳定ID在合并阶段统一分配。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 divide-async。
     * @returns ApiResponse_ScriptDivisionResult_ Successful Response
     * @throws ApiError
     */
    public static divideScriptApiV1ScriptProcessingDividePost({
        requestBody,
    }: {
        requestBody: ScriptDividerRequest,
    }): CancelablePromise<ApiResponse_ScriptDivisionResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/divide',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 异步合并多镜头的实体信息
     * 创建实体合并任务并立即返回 task_id；当前保留为预备能力，尚无真实前端入口。
     * @returns ApiResponse_AsyncTaskCreateRead_ Successful Response
     * @throws ApiError
     */
    public static mergeEntitiesAsyncApiV1ScriptProcessingMergeEntitiesAsyncPost({
        requestBody,
    }: {
        requestBody: EntityMergerRequest,
    }): CancelablePromise<ApiResponse_AsyncTaskCreateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/merge-entities-async',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 合并多镜头的实体信息
     * 输入全部分镜提取结果（可选带上脚本分镜与历史实体库），输出合并后的实体库：角色库/地点库/场景库/道具库（静态画像 + 变体列表）。该步骤会统一分配稳定ID（如 char_001/loc_001/prop_001/scene_001）。当提供 previous_merge 与 conflict_resolutions 时，将进行冲突重试合并，优先消解 conflicts 并尽量保持 ID 稳定。当前接口保留为预备能力，尚无真实前端入口。
     * @returns ApiResponse_EntityMergeResult_ Successful Response
     * @throws ApiError
     */
    public static mergeEntitiesApiV1ScriptProcessingMergeEntitiesPost({
        requestBody,
    }: {
        requestBody: EntityMergerRequest,
    }): CancelablePromise<ApiResponse_EntityMergeResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/merge-entities',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 异步分析服装/外形变体
     * 创建变体分析任务并立即返回 task_id；当前保留为预备能力，尚无真实前端入口。
     * @returns ApiResponse_AsyncTaskCreateRead_ Successful Response
     * @throws ApiError
     */
    public static analyzeVariantsAsyncApiV1ScriptProcessingAnalyzeVariantsAsyncPost({
        requestBody,
    }: {
        requestBody: VariantAnalysisRequest,
    }): CancelablePromise<ApiResponse_AsyncTaskCreateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/analyze-variants-async',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 分析服装/外形变体
     * 检测角色服装/外形变化，构建演变时间线，生成章节变体建议列表与变体建议。当前接口保留为预备能力，尚无真实前端入口。
     * @returns ApiResponse_VariantAnalysisResult_ Successful Response
     * @throws ApiError
     */
    public static analyzeVariantsApiV1ScriptProcessingAnalyzeVariantsPost({
        requestBody,
    }: {
        requestBody: VariantAnalysisRequest,
    }): CancelablePromise<ApiResponse_VariantAnalysisResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/analyze-variants',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
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
     * 检查角色混淆一致性（基于原文）
     * 检测同一角色在不同段落/镜头被赋予不同身份/行为主体导致混淆，并给出修改建议。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 check-consistency-async。
     * @returns ApiResponse_ScriptConsistencyCheckResult_ Successful Response
     * @throws ApiError
     */
    public static checkConsistencyApiV1ScriptProcessingCheckConsistencyPost({
        requestBody,
    }: {
        requestBody: ScriptConsistencyCheckRequest,
    }): CancelablePromise<ApiResponse_ScriptConsistencyCheckResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/check-consistency',
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
     * 分析人物画像缺失信息
     * 根据原文人物上下文与人物描述，判断缺少哪些关键信息，并给出优化后的人物画像描述。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 analyze-character-portrait-async。
     * @returns ApiResponse_CharacterPortraitAnalysisResult_ Successful Response
     * @throws ApiError
     */
    public static analyzeCharacterPortraitApiV1ScriptProcessingAnalyzeCharacterPortraitPost({
        requestBody,
    }: {
        requestBody: CharacterPortraitAnalysisRequest,
    }): CancelablePromise<ApiResponse_CharacterPortraitAnalysisResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/analyze-character-portrait',
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
     * 分析道具信息缺失项
     * 根据原文道具上下文与道具描述，判断缺少哪些关键信息，并给出优化后的可生成道具描述。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 analyze-prop-info-async。
     * @returns ApiResponse_PropInfoAnalysisResult_ Successful Response
     * @throws ApiError
     */
    public static analyzePropInfoApiV1ScriptProcessingAnalyzePropInfoPost({
        requestBody,
    }: {
        requestBody: PropInfoAnalysisRequest,
    }): CancelablePromise<ApiResponse_PropInfoAnalysisResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/analyze-prop-info',
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
     * 分析场景信息缺失项
     * 根据原文场景上下文与场景描述，判断缺少哪些关键信息，并给出优化后的可生成场景描述。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 analyze-scene-info-async。
     * @returns ApiResponse_SceneInfoAnalysisResult_ Successful Response
     * @throws ApiError
     */
    public static analyzeSceneInfoApiV1ScriptProcessingAnalyzeSceneInfoPost({
        requestBody,
    }: {
        requestBody: SceneInfoAnalysisRequest,
    }): CancelablePromise<ApiResponse_SceneInfoAnalysisResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/analyze-scene-info',
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
     * 分析服装信息缺失项
     * 根据原文服装上下文与服装描述，判断缺少哪些关键信息，并给出优化后的可生成服装描述。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 analyze-costume-info-async。
     * @returns ApiResponse_CostumeInfoAnalysisResult_ Successful Response
     * @throws ApiError
     */
    public static analyzeCostumeInfoApiV1ScriptProcessingAnalyzeCostumeInfoPost({
        requestBody,
    }: {
        requestBody: CostumeInfoAnalysisRequest,
    }): CancelablePromise<ApiResponse_CostumeInfoAnalysisResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/analyze-costume-info',
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
    /**
     * 异步项目级信息提取（最终输出）
     * 创建项目级信息提取任务并立即返回 task_id；前端可通过任务状态接口轮询。
     * @returns ApiResponse_AsyncTaskCreateRead_ Successful Response
     * @throws ApiError
     */
    public static extractScriptAsyncApiV1ScriptProcessingExtractAsyncPost({
        requestBody,
    }: {
        requestBody: ScriptExtractRequest,
    }): CancelablePromise<ApiResponse_AsyncTaskCreateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/extract-async',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 项目级信息提取（最终输出）
     * 输入分镜结果（可选带一致性检查结果），输出可导入 Studio 的草稿结构（name-based，ID 由导入接口生成）。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 extract-async。
     * @returns ApiResponse_StudioScriptExtractionDraft_ Successful Response
     * @throws ApiError
     */
    public static extractScriptApiV1ScriptProcessingExtractPost({
        requestBody,
    }: {
        requestBody: ScriptExtractRequest,
    }): CancelablePromise<ApiResponse_StudioScriptExtractionDraft_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/script-processing/extract',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
