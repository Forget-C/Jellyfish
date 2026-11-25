/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_CanvasMcpConnection_ } from '../models/ApiResponse_CanvasMcpConnection_';
import type { ApiResponse_CanvasMcpConnectionStatus_ } from '../models/ApiResponse_CanvasMcpConnectionStatus_';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class CanvasMcpService {
    /**
     * Connection Status
     * Report whether a credential is active without returning the credential itself.
     * @returns ApiResponse_CanvasMcpConnectionStatus_ Successful Response
     * @throws ApiError
     */
    public static canvasMcpConnectionStatus(): CancelablePromise<ApiResponse_CanvasMcpConnectionStatus_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/canvas-mcp/connection',
        });
    }
    /**
     * Open Connection
     * Issue a temporary credential. Opening a new connection invalidates the previous one.
     * @returns ApiResponse_CanvasMcpConnection_ Successful Response
     * @throws ApiError
     */
    public static canvasMcpOpenConnection(): CancelablePromise<ApiResponse_CanvasMcpConnection_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/canvas-mcp/connection',
        });
    }
    /**
     * Close Connection
     * Invalidate the active credential without affecting accepted canvas tasks.
     * @returns ApiResponse_CanvasMcpConnectionStatus_ Successful Response
     * @throws ApiError
     */
    public static canvasMcpCloseConnection(): CancelablePromise<ApiResponse_CanvasMcpConnectionStatus_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/canvas-mcp/connection',
        });
    }
}
