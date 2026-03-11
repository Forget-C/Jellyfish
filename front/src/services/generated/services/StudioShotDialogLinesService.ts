/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { ApiResponse_PaginatedData_ShotDialogLineRead__ } from '../models/ApiResponse_PaginatedData_ShotDialogLineRead__';
import type { ApiResponse_ShotDialogLineRead_ } from '../models/ApiResponse_ShotDialogLineRead_';
import type { ShotDialogLineCreate } from '../models/ShotDialogLineCreate';
import type { ShotDialogLineUpdate } from '../models/ShotDialogLineUpdate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioShotDialogLinesService {
    /**
     * 镜头对话行列表（分页）
     * @returns ApiResponse_PaginatedData_ShotDialogLineRead__ Successful Response
     * @throws ApiError
     */
    public static listShotDialogLinesApiV1StudioShotDialogLinesGet({
        shotDetailId,
        q,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        /**
         * 按镜头细节过滤
         */
        shotDetailId?: (string | null),
        /**
         * 关键字，过滤 text
         */
        q?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_ShotDialogLineRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/shot-dialog-lines',
            query: {
                'shot_detail_id': shotDetailId,
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
     * 创建镜头对话行
     * @returns ApiResponse_ShotDialogLineRead_ Successful Response
     * @throws ApiError
     */
    public static createShotDialogLineApiV1StudioShotDialogLinesPost({
        requestBody,
    }: {
        requestBody: ShotDialogLineCreate,
    }): CancelablePromise<ApiResponse_ShotDialogLineRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/shot-dialog-lines',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新镜头对话行
     * @returns ApiResponse_ShotDialogLineRead_ Successful Response
     * @throws ApiError
     */
    public static updateShotDialogLineApiV1StudioShotDialogLinesLineIdPatch({
        lineId,
        requestBody,
    }: {
        lineId: number,
        requestBody: ShotDialogLineUpdate,
    }): CancelablePromise<ApiResponse_ShotDialogLineRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/shot-dialog-lines/{line_id}',
            path: {
                'line_id': lineId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除镜头对话行
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteShotDialogLineApiV1StudioShotDialogLinesLineIdDelete({
        lineId,
    }: {
        lineId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/shot-dialog-lines/{line_id}',
            path: {
                'line_id': lineId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
