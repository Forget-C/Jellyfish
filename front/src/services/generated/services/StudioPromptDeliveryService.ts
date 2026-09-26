/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_PromptDeliveryRead_ } from '../models/ApiResponse_PromptDeliveryRead_';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioPromptDeliveryService {
    /**
     * 出口A 交付清单与预览（仅提示词）
     * @returns ApiResponse_PromptDeliveryRead_ Successful Response
     * @throws ApiError
     */
    public static previewPromptDeliveryApiV1StudioPromptDeliveryProjectIdGet({
        projectId,
        scope = 'episodes',
        chapterId,
        shotId,
        shotIds,
        sources,
        includeBindings = true,
    }: {
        projectId: string,
        /**
         * 范围：current_shot / episode / episodes
         */
        scope?: string,
        /**
         * 当前集范围时的章节 ID
         */
        chapterId?: (string | null),
        /**
         * 当前镜头范围时的镜头 ID
         */
        shotId?: (string | null),
        /**
         * 选中镜头范围：逗号分隔的镜头 ID（优先于 chapter_id；用于「导出/判就绪只按勾选范围」）
         */
        shotIds?: (string | null),
        /**
         * 提示词来源白名单（逗号分隔）；只给 jurilu 可与中控台逐字对齐
         */
        sources?: (string | null),
        /**
         * 交付文本是否带出绑定资产
         */
        includeBindings?: boolean,
    }): CancelablePromise<ApiResponse_PromptDeliveryRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/prompt-delivery/{project_id}',
            path: {
                'project_id': projectId,
            },
            query: {
                'scope': scope,
                'chapter_id': chapterId,
                'shot_id': shotId,
                'shot_ids': shotIds,
                'sources': sources,
                'include_bindings': includeBindings,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 出口A 下载交付文本（TXT + UTF-8 BOM）
     * @returns any Successful Response
     * @throws ApiError
     */
    public static exportPromptDeliveryApiV1StudioPromptDeliveryProjectIdExportGet({
        projectId,
        scope = 'episodes',
        chapterId,
        shotId,
        shotIds,
        sources,
        includeBindings = true,
    }: {
        projectId: string,
        /**
         * 范围：current_shot / episode / episodes
         */
        scope?: string,
        /**
         * 当前集范围时的章节 ID
         */
        chapterId?: (string | null),
        /**
         * 当前镜头范围时的镜头 ID
         */
        shotId?: (string | null),
        /**
         * 选中镜头范围：逗号分隔的镜头 ID
         */
        shotIds?: (string | null),
        /**
         * 提示词来源白名单（逗号分隔）
         */
        sources?: (string | null),
        /**
         * 交付文本是否带出绑定资产
         */
        includeBindings?: boolean,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/prompt-delivery/{project_id}/export',
            path: {
                'project_id': projectId,
            },
            query: {
                'scope': scope,
                'chapter_id': chapterId,
                'shot_id': shotId,
                'shot_ids': shotIds,
                'sources': sources,
                'include_bindings': includeBindings,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
