/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_CanvasCompiledInput_ } from '../models/ApiResponse_CanvasCompiledInput_';
import type { ApiResponse_CanvasModelCapability_ } from '../models/ApiResponse_CanvasModelCapability_';
import type { ApiResponse_CanvasPrecheck_ } from '../models/ApiResponse_CanvasPrecheck_';
import type { ApiResponse_CanvasRead_ } from '../models/ApiResponse_CanvasRead_';
import type { ApiResponse_CanvasRunAccepted_ } from '../models/ApiResponse_CanvasRunAccepted_';
import type { ApiResponse_CanvasSaved_ } from '../models/ApiResponse_CanvasSaved_';
import type { ApiResponse_CanvasSnapshot_ } from '../models/ApiResponse_CanvasSnapshot_';
import type { ApiResponse_CanvasStreamConnection_ } from '../models/ApiResponse_CanvasStreamConnection_';
import type { ApiResponse_list_CanvasRead__ } from '../models/ApiResponse_list_CanvasRead__';
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { CanvasCreate } from '../models/CanvasCreate';
import type { CanvasPrecheckRequest } from '../models/CanvasPrecheckRequest';
import type { CanvasRunSubmit } from '../models/CanvasRunSubmit';
import type { CanvasRuntimeEvent } from '../models/CanvasRuntimeEvent';
import type { CanvasSave } from '../models/CanvasSave';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioGenerationCanvasesService {
    /**
     * List Canvases
     * 列出项目画布。
     * @returns ApiResponse_list_CanvasRead__ Successful Response
     * @throws ApiError
     */
    public static canvasList({
        projectId,
    }: {
        projectId: string,
    }): CancelablePromise<ApiResponse_list_CanvasRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}',
            path: {
                'project_id': projectId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Canvas
     * 创建空画布。
     * @returns ApiResponse_CanvasRead_ Successful Response
     * @throws ApiError
     */
    public static canvasCreate({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: CanvasCreate,
    }): CancelablePromise<ApiResponse_CanvasRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{project_id}',
            path: {
                'project_id': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Canvas
     * 读取当前文档。
     * @returns ApiResponse_CanvasRead_ Successful Response
     * @throws ApiError
     */
    public static canvasGet({
        projectId,
        canvasId,
    }: {
        projectId: string,
        canvasId: string,
    }): CancelablePromise<ApiResponse_CanvasRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Save Canvas
     * CAS 保存完整文档并返回持久原回执。
     * @returns ApiResponse_CanvasSaved_ Successful Response
     * @throws ApiError
     */
    public static canvasSave({
        projectId,
        canvasId,
        requestBody,
    }: {
        projectId: string,
        canvasId: string,
        requestBody: CanvasSave,
    }): CancelablePromise<ApiResponse_CanvasSaved_> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `Conflict`,
                422: `Unprocessable Entity`,
            },
        });
    }
    /**
     * Delete Canvas
     * 删除无运行的画布。
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static canvasDelete({
        projectId,
        canvasId,
    }: {
        projectId: string,
        canvasId: string,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Model Capability
     * 核实画布归属后返回所选模型的真实输入与参数能力。
     * @returns ApiResponse_CanvasModelCapability_ Successful Response
     * @throws ApiError
     */
    public static canvasModelCapability({
        projectId,
        canvasId,
        modelId,
    }: {
        projectId: string,
        canvasId: string,
        modelId: string,
    }): CancelablePromise<ApiResponse_CanvasModelCapability_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/models/{model_id}/capability',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
                'model_id': modelId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Compile Canvas Card
     * 读取已保存文档的单次编译预览，不提交执行也不虚构模型输出。
     * @returns ApiResponse_CanvasCompiledInput_ Successful Response
     * @throws ApiError
     */
    public static canvasCompile({
        projectId,
        canvasId,
        cardId,
    }: {
        projectId: string,
        canvasId: string,
        cardId: string,
    }): CancelablePromise<ApiResponse_CanvasCompiledInput_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/cards/{card_id}/compile',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
                'card_id': cardId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Precheck Canvas
     * 核实已保存单卡的实际输入、模型及配置，返回短期预检凭据。
     * @returns ApiResponse_CanvasPrecheck_ Successful Response
     * @throws ApiError
     */
    public static canvasPrecheck({
        projectId,
        canvasId,
        requestBody,
    }: {
        projectId: string,
        canvasId: string,
        requestBody: CanvasPrecheckRequest,
    }): CancelablePromise<ApiResponse_CanvasPrecheck_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/precheck',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Submit Canvas Run
     * 原子受理并返回原或新运行；不在 HTTP 请求中调用供应商。
     * @returns ApiResponse_CanvasRunAccepted_ Successful Response
     * @throws ApiError
     */
    public static canvasRunSubmit({
        projectId,
        canvasId,
        requestBody,
    }: {
        projectId: string,
        canvasId: string,
        requestBody: CanvasRunSubmit,
    }): CancelablePromise<ApiResponse_CanvasRunAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/runs',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Canvas Runtime
     * 读取运行、累计正文和当前输出的一致切点。
     * @returns ApiResponse_CanvasSnapshot_ Successful Response
     * @throws ApiError
     */
    public static canvasRuntime({
        projectId,
        canvasId,
    }: {
        projectId: string,
        canvasId: string,
    }): CancelablePromise<ApiResponse_CanvasSnapshot_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/runtime',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Canvas Stream Connection
     * 提供 generated client 可获取的公共流连接地址。
     * @returns ApiResponse_CanvasStreamConnection_ Successful Response
     * @throws ApiError
     */
    public static canvasStreamConnection({
        projectId,
        canvasId,
    }: {
        projectId: string,
        canvasId: string,
    }): CancelablePromise<ApiResponse_CanvasStreamConnection_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/events/connection',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Canvas Events
     * 多运行 SSE；读取事务仅持续一次数据库追读，不随连接存活。
     * @returns CanvasRuntimeEvent Successful Response
     * @throws ApiError
     */
    public static canvasEvents({
        projectId,
        canvasId,
        cursor,
    }: {
        projectId: string,
        canvasId: string,
        cursor?: (number | null),
    }): CancelablePromise<CanvasRuntimeEvent> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/events',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
            },
            query: {
                'cursor': cursor,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
