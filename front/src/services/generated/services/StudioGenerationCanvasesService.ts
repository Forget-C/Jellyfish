/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_CanvasCardOutputs_ } from '../models/ApiResponse_CanvasCardOutputs_';
import type { ApiResponse_CanvasCatalog_ } from '../models/ApiResponse_CanvasCatalog_';
import type { ApiResponse_CanvasCheckPreview_ } from '../models/ApiResponse_CanvasCheckPreview_';
import type { ApiResponse_CanvasCheckReportRead_ } from '../models/ApiResponse_CanvasCheckReportRead_';
import type { ApiResponse_CanvasCompiledInput_ } from '../models/ApiResponse_CanvasCompiledInput_';
import type { ApiResponse_CanvasModelCapability_ } from '../models/ApiResponse_CanvasModelCapability_';
import type { ApiResponse_CanvasPostCheckPreview_ } from '../models/ApiResponse_CanvasPostCheckPreview_';
import type { ApiResponse_CanvasPrecheck_ } from '../models/ApiResponse_CanvasPrecheck_';
import type { ApiResponse_CanvasRead_ } from '../models/ApiResponse_CanvasRead_';
import type { ApiResponse_CanvasRunAccepted_ } from '../models/ApiResponse_CanvasRunAccepted_';
import type { ApiResponse_CanvasRunRead_ } from '../models/ApiResponse_CanvasRunRead_';
import type { ApiResponse_CanvasSaved_ } from '../models/ApiResponse_CanvasSaved_';
import type { ApiResponse_CanvasSnapshot_ } from '../models/ApiResponse_CanvasSnapshot_';
import type { ApiResponse_CanvasStreamConnection_ } from '../models/ApiResponse_CanvasStreamConnection_';
import type { ApiResponse_list_CanvasCheckProduct__ } from '../models/ApiResponse_list_CanvasCheckProduct__';
import type { ApiResponse_list_CanvasCheckReportRead__ } from '../models/ApiResponse_list_CanvasCheckReportRead__';
import type { ApiResponse_list_CanvasRead__ } from '../models/ApiResponse_list_CanvasRead__';
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { ApiResponse_Union_TextContentCard__ImageContentCard__VideoContentCard__ } from '../models/ApiResponse_Union_TextContentCard__ImageContentCard__VideoContentCard__';
import type { CanvasCheckRecheckRequest } from '../models/CanvasCheckRecheckRequest';
import type { CanvasCheckRequest } from '../models/CanvasCheckRequest';
import type { CanvasCreate } from '../models/CanvasCreate';
import type { CanvasPostCheckRequest } from '../models/CanvasPostCheckRequest';
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
     * CAS 保存完整文档并返回持久原回执。补齐同源兼容候选，新建来源须满足接收模型能力。
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
     * 仅删除已核对修订且没有活动任务的画布。
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static canvasDelete({
        projectId,
        canvasId,
        expectedRevision,
    }: {
        projectId: string,
        canvasId: string,
        expectedRevision: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
            },
            query: {
                'expected_revision': expectedRevision,
            },
            errors: {
                409: `Conflict`,
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
    /**
     * Cancel Canvas Run
     * 取消明确的一轮运行，返回真实节点状态而非提前宣告终态。
     * @returns ApiResponse_CanvasRunRead_ Successful Response
     * @throws ApiError
     */
    public static canvasCancelRun({
        projectId,
        canvasId,
        runId,
    }: {
        projectId: string,
        canvasId: string,
        runId: string,
    }): CancelablePromise<ApiResponse_CanvasRunRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/runs/{run_id}/cancel',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
                'run_id': runId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Cancel Canvas Node
     * 仅请求取消目标节点，终态由 TaskService 确认。
     * @returns ApiResponse_CanvasRunRead_ Successful Response
     * @throws ApiError
     */
    public static canvasCancelNode({
        projectId,
        canvasId,
        runId,
        nodeId,
    }: {
        projectId: string,
        canvasId: string,
        runId: string,
        nodeId: string,
    }): CancelablePromise<ApiResponse_CanvasRunRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/runs/{run_id}/nodes/{node_id}/cancel',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
                'run_id': runId,
                'node_id': nodeId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Canvas Output Content
     * 准备独立内容卡；调用方通过已有文档保存队列显式持久化。
     * @returns ApiResponse_Union_TextContentCard__ImageContentCard__VideoContentCard__ Successful Response
     * @throws ApiError
     */
    public static canvasOutputContent({
        projectId,
        canvasId,
        runId,
        nodeId,
        position,
    }: {
        projectId: string,
        canvasId: string,
        runId: string,
        nodeId: string,
        position: number,
    }): CancelablePromise<ApiResponse_Union_TextContentCard__ImageContentCard__VideoContentCard__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/runs/{run_id}/nodes/{node_id}/outputs/{position}/content',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
                'run_id': runId,
                'node_id': nodeId,
                'position': position,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Card Outputs
     * 展示已保存修订的明确出口及直接候选，不修改绑定。
     * @returns ApiResponse_CanvasCardOutputs_ Successful Response
     * @throws ApiError
     */
    public static canvasCardOutputs({
        projectId,
        canvasId,
        cardId,
    }: {
        projectId: string,
        canvasId: string,
        cardId: string,
    }): CancelablePromise<ApiResponse_CanvasCardOutputs_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/cards/{card_id}/outputs',
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
     * Get Canvas Catalog
     * 核实画布归属后提供卡片、兼容用途、采用策略及单值输入约束。
     * @returns ApiResponse_CanvasCatalog_ Successful Response
     * @throws ApiError
     */
    public static canvasCatalog({
        projectId,
        canvasId,
    }: {
        projectId: string,
        canvasId: string,
    }): CancelablePromise<ApiResponse_CanvasCatalog_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/catalog',
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
     * Preview Canvas Check
     * 查看该检查卡连接的已保存模型及可用项目。
     * @returns ApiResponse_CanvasCheckPreview_ Successful Response
     * @throws ApiError
     */
    public static canvasCheckPreview({
        projectId,
        canvasId,
        cardId,
    }: {
        projectId: string,
        canvasId: string,
        cardId: string,
    }): CancelablePromise<ApiResponse_CanvasCheckPreview_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/checks/{card_id}',
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
     * Run Canvas Check
     * 执行用户选择的检查范围，写入独立报告。
     * @returns ApiResponse_CanvasCheckReportRead_ Successful Response
     * @throws ApiError
     */
    public static canvasCheckRun({
        projectId,
        canvasId,
        cardId,
        requestBody,
    }: {
        projectId: string,
        canvasId: string,
        cardId: string,
        requestBody: CanvasCheckRequest,
    }): CancelablePromise<ApiResponse_CanvasCheckReportRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/checks/{card_id}/runs',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
                'card_id': cardId,
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
     * Get Canvas Check Reports
     * 按原检查卡身份读取该项目画布内的报告。
     * @returns ApiResponse_list_CanvasCheckReportRead__ Successful Response
     * @throws ApiError
     */
    public static canvasCheckReports({
        projectId,
        canvasId,
        cardId,
    }: {
        projectId: string,
        canvasId: string,
        cardId: string,
    }): CancelablePromise<ApiResponse_list_CanvasCheckReportRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/checks/{card_id}/reports',
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
     * Canvas Check Products
     * List retained text outputs for the saved observation target.
     * @returns ApiResponse_list_CanvasCheckProduct__ Successful Response
     * @throws ApiError
     */
    public static canvasCheckProducts({
        projectId,
        canvasId,
        cardId,
    }: {
        projectId: string,
        canvasId: string,
        cardId: string,
    }): CancelablePromise<ApiResponse_list_CanvasCheckProduct__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/checks/{card_id}/products',
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
     * Canvas Post Check Preview
     * Show one pinned product, original basis and estimated model calls.
     * @returns ApiResponse_CanvasPostCheckPreview_ Successful Response
     * @throws ApiError
     */
    public static canvasPostCheckPreview({
        projectId,
        canvasId,
        cardId,
        runId,
        nodeId,
        position,
    }: {
        projectId: string,
        canvasId: string,
        cardId: string,
        runId: string,
        nodeId: string,
        position: number,
    }): CancelablePromise<ApiResponse_CanvasPostCheckPreview_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/checks/{card_id}/products/{run_id}/{node_id}/{position}',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
                'card_id': cardId,
                'run_id': runId,
                'node_id': nodeId,
                'position': position,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Canvas Post Check Run
     * Admit an explicit historical product inspection.
     * @returns ApiResponse_CanvasCheckReportRead_ Successful Response
     * @throws ApiError
     */
    public static canvasPostCheckRun({
        projectId,
        canvasId,
        cardId,
        runId,
        nodeId,
        position,
        requestBody,
    }: {
        projectId: string,
        canvasId: string,
        cardId: string,
        runId: string,
        nodeId: string,
        position: number,
        requestBody: CanvasPostCheckRequest,
    }): CancelablePromise<ApiResponse_CanvasCheckReportRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/checks/{card_id}/products/{run_id}/{node_id}/{position}/runs',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
                'card_id': cardId,
                'run_id': runId,
                'node_id': nodeId,
                'position': position,
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
     * Cancel Canvas Check
     * 请求停止该报告尚未完成的检查任务，并返回当前执行事实。
     * @returns ApiResponse_CanvasCheckReportRead_ Successful Response
     * @throws ApiError
     */
    public static canvasCheckCancel({
        projectId,
        canvasId,
        cardId,
        reportId,
    }: {
        projectId: string,
        canvasId: string,
        cardId: string,
        reportId: string,
    }): CancelablePromise<ApiResponse_CanvasCheckReportRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/checks/{card_id}/reports/{report_id}/cancel',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
                'card_id': cardId,
                'report_id': reportId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Archived Canvas Check Reports
     * 读取当前画布中已删检查卡留下的原报告。
     * @returns ApiResponse_list_CanvasCheckReportRead__ Successful Response
     * @throws ApiError
     */
    public static canvasCheckArchivedReports({
        projectId,
        canvasId,
    }: {
        projectId: string,
        canvasId: string,
    }): CancelablePromise<ApiResponse_list_CanvasCheckReportRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/check-reports/archived',
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
     * Recheck Canvas Report
     * Run one completed finding against the evidence of its original report.
     * @returns ApiResponse_CanvasCheckReportRead_ Successful Response
     * @throws ApiError
     */
    public static canvasCheckRecheck({
        projectId,
        canvasId,
        cardId,
        reportId,
        requestBody,
    }: {
        projectId: string,
        canvasId: string,
        cardId: string,
        reportId: string,
        requestBody: CanvasCheckRecheckRequest,
    }): CancelablePromise<ApiResponse_CanvasCheckReportRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/checks/{card_id}/reports/{report_id}/recheck',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
                'card_id': cardId,
                'report_id': reportId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Unprocessable Entity`,
            },
        });
    }
}
