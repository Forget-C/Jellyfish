/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_dict_str__Any__ } from '../models/ApiResponse_dict_str__Any__';
import type { BoardDraftClaimRequest } from '../models/BoardDraftClaimRequest';
import type { BoardDraftReleaseRequest } from '../models/BoardDraftReleaseRequest';
import type { BoardDraftRequest } from '../models/BoardDraftRequest';
import type { BoardDraftSaveRequest } from '../models/BoardDraftSaveRequest';
import type { BoardImportParseRequest } from '../models/BoardImportParseRequest';
import type { BoardSaveRequest } from '../models/BoardSaveRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioPromptBoardService {
    /**
     * 集级提示词看板（只读）
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static getBoardApiV1StudioPromptBoardChapterIdGet({
        chapterId,
    }: {
        chapterId: string,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/prompt-board/{chapter_id}',
            path: {
                'chapter_id': chapterId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 集级就绪批量读取（每镜提示词/绑定/参考帧，只读）
     * 顶部三态、未完成镜头定位、生产卡门禁共用的**同一份原始就绪数据**。
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static getBoardReadinessApiV1StudioPromptBoardChapterIdReadinessGet({
        chapterId,
        referenceMode = 'first',
    }: {
        chapterId: string,
        referenceMode?: string,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/prompt-board/{chapter_id}/readiness',
            path: {
                'chapter_id': chapterId,
            },
            query: {
                'reference_mode': referenceMode,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 单镜生成视频提示词草稿（真 LLM；只落草稿表）
     * 一次只为一镜生成草稿：页面据此维护逐镜队列，用户点停止即不再发下一镜。
     *
     * 真实生成成功后草稿**立刻落服务端**（刷新/中断不丢），正式提示词列不动；
     * 同一镜若已有进行中的生成，返回 ``status="busy"`` 且不发起调用（防重复付费）。
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static draftBoardShotApiV1StudioPromptBoardChapterIdDraftPost({
        chapterId,
        requestBody,
    }: {
        chapterId: string,
        requestBody: BoardDraftRequest,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/prompt-board/{chapter_id}/draft',
            path: {
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 逐镜草稿状态（刷新/中断后恢复队列，只读草稿表）
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static getBoardDraftsApiV1StudioPromptBoardChapterIdDraftsGet({
        chapterId,
    }: {
        chapterId: string,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/prompt-board/{chapter_id}/drafts',
            path: {
                'chapter_id': chapterId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 保存一镜草稿（幂等 upsert；不写正式提示词列）
     * 每镜生成结束后调用：成功存正文、失败存原因。
     *
     * 正文**只有**经 ``/save`` 才会进 ``shot_details.video_prompt``；
     * 本接口一个字节都不写正式列。
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static saveBoardDraftApiV1StudioPromptBoardChapterIdDraftsPost({
        chapterId,
        requestBody,
    }: {
        chapterId: string,
        requestBody: BoardDraftSaveRequest,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/prompt-board/{chapter_id}/drafts',
            path: {
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 清草稿（默认整集；可只清指定镜头）
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static deleteBoardDraftsApiV1StudioPromptBoardChapterIdDraftsDelete({
        chapterId,
        shotIds = '',
    }: {
        chapterId: string,
        /**
         * 逗号分隔的镜头 ID；空 = 清整集
         */
        shotIds?: string,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/prompt-board/{chapter_id}/drafts',
            path: {
                'chapter_id': chapterId,
            },
            query: {
                'shot_ids': shotIds,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 抢占一镜「生成中」租约（同一镜防并发生成/重复付费）
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static claimBoardDraftApiV1StudioPromptBoardChapterIdDraftsClaimPost({
        chapterId,
        requestBody,
    }: {
        chapterId: string,
        requestBody: BoardDraftClaimRequest,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/prompt-board/{chapter_id}/drafts/claim',
            path: {
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 释放一镜「生成中」租约（不生成时用）
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static releaseBoardDraftApiV1StudioPromptBoardChapterIdDraftsReleasePost({
        chapterId,
        requestBody,
    }: {
        chapterId: string,
        requestBody: BoardDraftReleaseRequest,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/prompt-board/{chapter_id}/drafts/release',
            path: {
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 批量导入：解析并匹配（不落库）
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static parseBoardImportApiV1StudioPromptBoardChapterIdImportParsePost({
        chapterId,
        requestBody,
    }: {
        chapterId: string,
        requestBody: BoardImportParseRequest,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/prompt-board/{chapter_id}/import-parse',
            path: {
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 确认后批量保存（覆盖模式三选一）
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static saveBoardApiV1StudioPromptBoardChapterIdSavePost({
        chapterId,
        requestBody,
    }: {
        chapterId: string,
        requestBody: BoardSaveRequest,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/prompt-board/{chapter_id}/save',
            path: {
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
