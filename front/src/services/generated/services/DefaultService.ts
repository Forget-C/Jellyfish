/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DefaultService {
    /**
     * Health
     * 健康检查。
     * @returns any Successful Response
     * @throws ApiError
     */
    public static healthHealthGet(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/health',
        });
    }
    /**
     * Serve Local File
     * 本地存储驱动下的文件回放。
     *
     * 只在 ``STORAGE_DRIVER=local`` 时可用；S3 驱动下由对象存储自己的
     * 公网地址提供服务，走本路由没有意义，直接 404。
     * @returns any Successful Response
     * @throws ApiError
     */
    public static serveLocalFileFilesKeyGet({
        key,
    }: {
        key: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/files/{key}',
            path: {
                'key': key,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
