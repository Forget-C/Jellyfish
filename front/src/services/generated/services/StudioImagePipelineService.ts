/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AdoptImageRequest } from '../models/AdoptImageRequest';
import type { ApiResponse_AdoptImageRead_ } from '../models/ApiResponse_AdoptImageRead_';
import type { ApiResponse_FrameSubmitPlanRead_ } from '../models/ApiResponse_FrameSubmitPlanRead_';
import type { ApiResponse_FrameSubmitRead_ } from '../models/ApiResponse_FrameSubmitRead_';
import type { ApiResponse_ImagePlanPreviewRead_ } from '../models/ApiResponse_ImagePlanPreviewRead_';
import type { ApiResponse_ImageServiceStatusRead_ } from '../models/ApiResponse_ImageServiceStatusRead_';
import type { ApiResponse_ImageSubmitRead_ } from '../models/ApiResponse_ImageSubmitRead_';
import type { ApiResponse_ImageTaskQueryRead_ } from '../models/ApiResponse_ImageTaskQueryRead_';
import type { ApiResponse_PromptPackageRead_ } from '../models/ApiResponse_PromptPackageRead_';
import type { ApiResponse_VideoSubmitPlanRead_ } from '../models/ApiResponse_VideoSubmitPlanRead_';
import type { ApiResponse_VideoSubmitRead_ } from '../models/ApiResponse_VideoSubmitRead_';
import type { FrameSubmitPlanRequest } from '../models/FrameSubmitPlanRequest';
import type { FrameSubmitRequest } from '../models/FrameSubmitRequest';
import type { ImagePlanPreviewRequest } from '../models/ImagePlanPreviewRequest';
import type { ImageSubmitRequest } from '../models/ImageSubmitRequest';
import type { PromptPackageRequest } from '../models/PromptPackageRequest';
import type { VideoSubmitPlanRequest } from '../models/VideoSubmitPlanRequest';
import type { VideoSubmitRequest } from '../models/VideoSubmitRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioImagePipelineService {
    /**
     * 出图服务对接状态（DRY_RUN 下不探测）
     * 返回出图服务基址、守卫状态与契约能力；DRY_RUN 下**不发起健康探测**。
     * @returns ApiResponse_ImageServiceStatusRead_ Successful Response
     * @throws ApiError
     */
    public static getImagePipelineStatusApiV1StudioImagePipelineStatusGet(): CancelablePromise<ApiResponse_ImageServiceStatusRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/image-pipeline/status',
        });
    }
    /**
     * 出图提交计划预览（定妆照 / 垫图批量，不触网）
     * 组装提交给出图服务的计划：幂等键、垫图来源、OSS 对象键模板，全部只读。
     * @returns ApiResponse_ImagePlanPreviewRead_ Successful Response
     * @throws ApiError
     */
    public static previewImagePlanApiV1StudioImagePipelinePlanPreviewPost({
        requestBody,
    }: {
        requestBody: ImagePlanPreviewRequest,
    }): CancelablePromise<ApiResponse_ImagePlanPreviewRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/image-pipeline/plan/preview',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 提交出图任务（DRY_RUN 下返回占位结果，不触网）
     * 受守卫的出图提交。默认 DRY_RUN：返回占位 task_id 与不可达占位地址。
     *
     * 提交前会逐张探活每一条垫图 URL（``preflight_guard``）：不可达就**一个请求都不提交**，
     * 返回结构化中文错误（哪张图 / 哪个资产 / 实际状态码 / 怎么修），且不产生任何付费调用。
     * @returns ApiResponse_ImageSubmitRead_ Successful Response
     * @throws ApiError
     */
    public static submitImagePlanApiV1StudioImagePipelineSubmitPost({
        requestBody,
    }: {
        requestBody: ImageSubmitRequest,
    }): CancelablePromise<ApiResponse_ImageSubmitRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/image-pipeline/submit',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 查询出图任务（回读 OSS 地址）
     * 查询出图任务状态与产物地址。DRY_RUN 下不触网，直接返回未创建说明。
     * @returns ApiResponse_ImageTaskQueryRead_ Successful Response
     * @throws ApiError
     */
    public static queryImageTaskApiV1StudioImagePipelineTaskServiceTaskIdGet({
        serviceTaskId,
    }: {
        serviceTaskId: string,
    }): CancelablePromise<ApiResponse_ImageTaskQueryRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/image-pipeline/task/{service_task_id}',
            path: {
                'service_task_id': serviceTaskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 直提出视频的计划预览（不建任务、不触网）
     * 解析供应商/模型/参考图/提示词，如实标注会踩的坑，但不提交任何任务。
     * @returns ApiResponse_VideoSubmitPlanRead_ Successful Response
     * @throws ApiError
     */
    public static previewVideoSubmitPlanApiV1StudioImagePipelineVideoPlanPreviewPost({
        requestBody,
    }: {
        requestBody: VideoSubmitPlanRequest,
    }): CancelablePromise<ApiResponse_VideoSubmitPlanRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/image-pipeline/video-plan/preview',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 直提出视频（默认被 DRY_RUN 拦截，不产生费用）
     * 同步提交一次视频生成；DRY_RUN 开启时返回 dry_run 占位结果，不发任何请求。
     *
     * 真实提交前会做**第二层可达性复核**（``preflight_guard``）：本次真正发往供应商的
     * 首/尾/关键帧参考图与参考音频地址，逐张匿名探活；不可达就不发请求、不产生费用
     * （真实故障 A 就是这里把只在本机可读的地址交给了上游）。
     * @returns ApiResponse_VideoSubmitRead_ Successful Response
     * @throws ApiError
     */
    public static submitVideoRouteApiV1StudioImagePipelineVideoSubmitPost({
        requestBody,
    }: {
        requestBody: VideoSubmitRequest,
    }): CancelablePromise<ApiResponse_VideoSubmitRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/image-pipeline/video-submit',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 关键帧出图计划预览（不触网、不建任务、不写库）
     * 如实展示「这一帧会用什么提示词、带哪些参考图、什么画幅」——全部只读。
     * @returns ApiResponse_FrameSubmitPlanRead_ Successful Response
     * @throws ApiError
     */
    public static previewFramePlanApiV1StudioImagePipelineFramePlanPreviewPost({
        requestBody,
    }: {
        requestBody: FrameSubmitPlanRequest,
    }): CancelablePromise<ApiResponse_FrameSubmitPlanRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/image-pipeline/frame-plan/preview',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 关键帧出图（同进程内联执行；DRY_RUN 下只回计划不写库）
     * 在**同一个进程内**跑完一次关键帧出图，并把结果写进 ``shot_frame_images.file_id``。
     *
     * 为什么不用队列：本机没有 broker/worker，队列路径只会留下一条永远不执行的「排队中」，
     * 用户看到的就是「点了生成什么也没发生」。同进程内联执行是 P3 直提端点既有的做法。
     *
     * 提交前会逐张探活参考图（``preflight_guard``）：不可达就在**写库/建任务之前**拒绝，
     * 返回结构化中文错误，一次付费调用都不产生。
     * @returns ApiResponse_FrameSubmitRead_ Successful Response
     * @throws ApiError
     */
    public static submitFrameRouteApiV1StudioImagePipelineFrameSubmitPost({
        requestBody,
    }: {
        requestBody: FrameSubmitRequest,
    }): CancelablePromise<ApiResponse_FrameSubmitRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/image-pipeline/frame-submit',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 采纳生成的图片到资产图片槽位（落库，刷新后仍在）
     * 把出图结果（oss_url / local_path）下载入库并写回图片槽位。
     *
     * 这是断点③的落点：出图提交本身不写库，必须由用户显式"采纳"才落正式产物。
     * DRY_RUN 占位地址会被拒绝。
     * @returns ApiResponse_AdoptImageRead_ Successful Response
     * @throws ApiError
     */
    public static adoptGeneratedImageRouteApiV1StudioImagePipelineAdoptPost({
        requestBody,
    }: {
        requestBody: AdoptImageRequest,
    }): CancelablePromise<ApiResponse_AdoptImageRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/image-pipeline/adopt',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 提示词包导出（图片 + 视频 + 绑定资产 + 参考图，只读）
     * 把一个项目/一批镜头打成提示词包（json + text + markdown），不写库、不出图。
     * @returns ApiResponse_PromptPackageRead_ Successful Response
     * @throws ApiError
     */
    public static exportPromptPackageApiV1StudioImagePipelinePromptPackagePost({
        requestBody,
    }: {
        requestBody: PromptPackageRequest,
    }): CancelablePromise<ApiResponse_PromptPackageRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/image-pipeline/prompt-package',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
