/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_QuickSkillContextRead_ } from '../models/ApiResponse_QuickSkillContextRead_';
import type { ApiResponse_QuickSkillGenerateRead_ } from '../models/ApiResponse_QuickSkillGenerateRead_';
import type { ApiResponse_QuickSkillListRead_ } from '../models/ApiResponse_QuickSkillListRead_';
import type { ApiResponse_QuickSkillSaveRead_ } from '../models/ApiResponse_QuickSkillSaveRead_';
import type { QuickSkillExportRequest } from '../models/QuickSkillExportRequest';
import type { QuickSkillGenerateRequest } from '../models/QuickSkillGenerateRequest';
import type { QuickSkillSaveRequest } from '../models/QuickSkillSaveRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioQuickSkillService {
    /**
     * 导演 Skill 目录
     * @returns ApiResponse_QuickSkillListRead_ Successful Response
     * @throws ApiError
     */
    public static listQuickSkillsApiV1StudioQuickSkillSkillsGet(): CancelablePromise<ApiResponse_QuickSkillListRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/quick-skill/skills',
        });
    }
    /**
     * 装配中台上下文（只读，不调模型）
     * @returns ApiResponse_QuickSkillContextRead_ Successful Response
     * @throws ApiError
     */
    public static previewQuickSkillContextApiV1StudioQuickSkillContextGet({
        chapterId,
        shotId,
    }: {
        /**
         * 章节 ID
         */
        chapterId?: (string | null),
        /**
         * 镜头 ID
         */
        shotId?: (string | null),
    }): CancelablePromise<ApiResponse_QuickSkillContextRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/quick-skill/context',
            query: {
                'chapter_id': chapterId,
                'shot_id': shotId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 按导演 Skill 生成提示词（会真实调用文字模型）
     * @returns ApiResponse_QuickSkillGenerateRead_ Successful Response
     * @throws ApiError
     */
    public static generateQuickSkillApiV1StudioQuickSkillGeneratePost({
        requestBody,
    }: {
        requestBody: QuickSkillGenerateRequest,
    }): CancelablePromise<ApiResponse_QuickSkillGenerateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/quick-skill/generate',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 把提示词写进镜头（source=skill）
     * @returns ApiResponse_QuickSkillSaveRead_ Successful Response
     * @throws ApiError
     */
    public static saveQuickSkillToShotApiV1StudioQuickSkillSaveToShotPost({
        requestBody,
    }: {
        requestBody: QuickSkillSaveRequest,
    }): CancelablePromise<ApiResponse_QuickSkillSaveRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/quick-skill/save-to-shot',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 导出 Skill 提示词 TXT（UTF-8 BOM）
     * 导出已生成的提示词为 TXT。
     *
     * 刻意**不在这里调模型**：导出用的正文由调用方（前端）把 `/generate` 的结果传回来，
     * 这样"预览"和"下载"是同一份文本，也不会因为点两次下载就付两次费。
     * @returns any Successful Response
     * @throws ApiError
     */
    public static exportQuickSkillApiV1StudioQuickSkillExportPost({
        requestBody,
    }: {
        requestBody: QuickSkillExportRequest,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/quick-skill/export',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
