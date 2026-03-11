/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { ApiResponse_PaginatedData_ShotRead__ } from '../models/ApiResponse_PaginatedData_ShotRead__';
import type { ApiResponse_ShotRead_ } from '../models/ApiResponse_ShotRead_';
import type { ShotCreate } from '../models/ShotCreate';
import type { ShotUpdate } from '../models/ShotUpdate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioShotsService {
    /**
     * 镜头列表（分页）
     * @returns ApiResponse_PaginatedData_ShotRead__ Successful Response
     * @throws ApiError
     */
    public static listShotsApiV1StudioShotsGet({
        chapterId,
        q,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        /**
         * 按章节过滤
         */
        chapterId?: (string | null),
        /**
         * 关键字，过滤 title/script_excerpt
         */
        q?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_ShotRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/shots',
            query: {
                'chapter_id': chapterId,
                'q': q,
                'order': order,
                'is_desc': isDesc,
                'page': page,
                'page_size': pageSize,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 创建镜头
     * @returns ApiResponse_ShotRead_ Successful Response
     * @throws ApiError
     */
    public static createShotApiV1StudioShotsPost({
        requestBody,
    }: {
        requestBody: ShotCreate,
    }): CancelablePromise<ApiResponse_ShotRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/shots',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 获取镜头
     * @returns ApiResponse_ShotRead_ Successful Response
     * @throws ApiError
     */
    public static getShotApiV1StudioShotsShotIdGet({
        shotId,
    }: {
        shotId: string,
    }): CancelablePromise<ApiResponse_ShotRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/shots/{shot_id}',
            path: {
                'shot_id': shotId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新镜头
     * @returns ApiResponse_ShotRead_ Successful Response
     * @throws ApiError
     */
    public static updateShotApiV1StudioShotsShotIdPatch({
        shotId,
        requestBody,
    }: {
        shotId: string,
        requestBody: ShotUpdate,
    }): CancelablePromise<ApiResponse_ShotRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/shots/{shot_id}',
            path: {
                'shot_id': shotId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除镜头
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteShotApiV1StudioShotsShotIdDelete({
        shotId,
    }: {
        shotId: string,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/shots/{shot_id}',
            path: {
                'shot_id': shotId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
