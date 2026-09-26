/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_AssetBindingPreviewRead_ } from '../models/ApiResponse_AssetBindingPreviewRead_';
import type { ApiResponse_dict_str__Any__ } from '../models/ApiResponse_dict_str__Any__';
import type { ApiResponse_EntityExtractionPreviewRead_ } from '../models/ApiResponse_EntityExtractionPreviewRead_';
import type { ApiResponse_ImagePromptPreviewRead_ } from '../models/ApiResponse_ImagePromptPreviewRead_';
import type { ApiResponse_VideoPromptPreviewRead_ } from '../models/ApiResponse_VideoPromptPreviewRead_';
import type { AssetBindingPreviewRequest } from '../models/AssetBindingPreviewRequest';
import type { EntityExtractionPreviewRequest } from '../models/EntityExtractionPreviewRequest';
import type { ImagePromptPreviewRequest } from '../models/ImagePromptPreviewRequest';
import type { VideoPromptPreviewRequest } from '../models/VideoPromptPreviewRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioLlmService {
    /**
     * LLM 编排层状态（DRY_RUN 守卫 + 词表）
     * 查询守卫状态与确定性词表，便于确认「当前不会真实付费」。
     *
     * 演练/真实模式的字段（前端角标按这些字段渲染，全部中文可照做）：
     * - ``mode`` / ``mode_label`` / ``mode_description``：当前模式与一句话说明；
     * - ``outlet_states``：llm / image / video / oss 四个出口各自是否放行、被拦原因；
     * - ``switch_source`` / ``switch_source_label`` / ``guard.source``：两个开关**写在哪**
     * （``env`` 进程环境变量 / ``dotenv`` backend/.env / ``default`` 都没写）；
     * ``dotenv_real_mode`` 为 ``true`` 表示真实模式是由 ``.env`` 打开的（此时后端启动会告警）；
     * - ``enable_steps`` / ``how_to_enable``：怎么切到真实模式；``restore_steps``：怎么关回演练。
     * 既有字段（``guard`` / ``guard_status_text`` / ``paid_outlet_guards`` / ``dry_run_audit``）
     * 保持向后兼容，只做加法。
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static getOrchestrationStatusApiV1StudioLlmOrchestrationStatusGet(): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/llm/orchestration/status',
        });
    }
    /**
     * 实体提取预览（只返回草稿，不建实体）
     * 从章节/剧本文本提取实体清单草稿，经确定性后校验后返回预览。
     * @returns ApiResponse_EntityExtractionPreviewRead_ Successful Response
     * @throws ApiError
     */
    public static previewEntityExtractionRouteApiV1StudioLlmEntityExtractionPreviewPost({
        requestBody,
    }: {
        requestBody: EntityExtractionPreviewRequest,
    }): CancelablePromise<ApiResponse_EntityExtractionPreviewRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/llm/entity-extraction/preview',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 图片提示词逐槽位生成预览（不落库、不出图）
     * 按 Jellyfish 提示词类别逐槽位生成图片提示词（分层结构 + 画像卡一致性）。
     * @returns ApiResponse_ImagePromptPreviewRead_ Successful Response
     * @throws ApiError
     */
    public static previewImagePromptsRouteApiV1StudioLlmImagePromptPreviewPost({
        requestBody,
    }: {
        requestBody: ImagePromptPreviewRequest,
    }): CancelablePromise<ApiResponse_ImagePromptPreviewRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/llm/image-prompt/preview',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 视频提示词生成预览（不提交视频任务）
     * 生成视频提示词（标准运镜词库 + 首尾帧模式支持），结构对齐镜头上下文包。
     * @returns ApiResponse_VideoPromptPreviewRead_ Successful Response
     * @throws ApiError
     */
    public static previewVideoPromptRouteApiV1StudioLlmVideoPromptPreviewPost({
        requestBody,
    }: {
        requestBody: VideoPromptPreviewRequest,
    }): CancelablePromise<ApiResponse_VideoPromptPreviewRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/llm/video-prompt/preview',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 资产绑定预览（LLM 实体链接 + 置信度分层，只建议不写库）
     * 为项目/指定镜头生成资产绑定建议。
     *
     * 覆盖角色/场景/道具/服装四类槽位，按置信度分层，并与启发式及已有绑定对账。
     * **本接口不写库**；人工确认后请调用 ``suggestions[].confirm_endpoint`` 指向的现有端点。
     * @returns ApiResponse_AssetBindingPreviewRead_ Successful Response
     * @throws ApiError
     */
    public static previewAssetBindingRouteApiV1StudioLlmAssetBindingPreviewPost({
        requestBody,
    }: {
        requestBody: AssetBindingPreviewRequest,
    }): CancelablePromise<ApiResponse_AssetBindingPreviewRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/llm/asset-binding/preview',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
