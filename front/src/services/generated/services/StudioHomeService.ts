/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_list_HomeRecentAsset__ } from '../models/ApiResponse_list_HomeRecentAsset__';
import type { ApiResponse_list_HomeRecentCanvas__ } from '../models/ApiResponse_list_HomeRecentCanvas__';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioHomeService {
    /**
     * Get Recent Canvases
     * 展示最近保存的三张画布。
     * @returns ApiResponse_list_HomeRecentCanvas__ Successful Response
     * @throws ApiError
     */
    public static homeRecentCanvases(): CancelablePromise<ApiResponse_list_HomeRecentCanvas__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/home/recent-canvases',
        });
    }
    /**
     * Get Recent Assets
     * 展示资产库中档案更新时间最近的六项资产。
     * @returns ApiResponse_list_HomeRecentAsset__ Successful Response
     * @throws ApiError
     */
    public static homeRecentAssets(): CancelablePromise<ApiResponse_list_HomeRecentAsset__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/home/recent-assets',
        });
    }
}
