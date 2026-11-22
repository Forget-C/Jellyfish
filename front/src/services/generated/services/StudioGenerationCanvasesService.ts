/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_CanvasAssistantExchange_ } from '../models/ApiResponse_CanvasAssistantExchange_';
import type { ApiResponse_CanvasAssistantHistory_ } from '../models/ApiResponse_CanvasAssistantHistory_';
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
import type { ApiResponse_ImageContentCard_ } from '../models/ApiResponse_ImageContentCard_';
import type { ApiResponse_list_CanvasCheckProduct__ } from '../models/ApiResponse_list_CanvasCheckProduct__';
import type { ApiResponse_list_CanvasCheckReportRead__ } from '../models/ApiResponse_list_CanvasCheckReportRead__';
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { ApiResponse_PaginatedData_CanvasSummary__ } from '../models/ApiResponse_PaginatedData_CanvasSummary__';
import type { ApiResponse_Union_TextContentCard__ImageContentCard__VideoContentCard__ } from '../models/ApiResponse_Union_TextContentCard__ImageContentCard__VideoContentCard__';
import type { CanvasAssistantMessage } from '../models/CanvasAssistantMessage';
import type { CanvasCheckRecheckRequest } from '../models/CanvasCheckRecheckRequest';
import type { CanvasCheckRequest } from '../models/CanvasCheckRequest';
import type { CanvasCreate } from '../models/CanvasCreate';
import type { CanvasPostCheckRequest } from '../models/CanvasPostCheckRequest';
import type { CanvasPrecheckRequest } from '../models/CanvasPrecheckRequest';
import type { CanvasRename } from '../models/CanvasRename';
import type { CanvasRunSubmit } from '../models/CanvasRunSubmit';
import type { CanvasRuntimeEvent } from '../models/CanvasRuntimeEvent';
import type { CanvasSave } from '../models/CanvasSave';
import type { CanvasVideoFrameRequest } from '../models/CanvasVideoFrameRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioGenerationCanvasesService {
    /**
     * List Canvases
     * 分页读取独立画布摘要。
     * @returns ApiResponse_PaginatedData_CanvasSummary__ Successful Response
     * @throws ApiError
     */
    public static canvasList({
        q = '',
        page = 1,
        pageSize = 24,
    }: {
        q?: string,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_CanvasSummary__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases',
            query: {
                'q': q,
                'page': page,
                'page_size': pageSize,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Canvas
     * 创建不依赖项目的自由画布。
     * @returns ApiResponse_CanvasRead_ Successful Response
     * @throws ApiError
     */
    public static canvasCreate({
        requestBody,
    }: {
        requestBody: CanvasCreate,
    }): CancelablePromise<ApiResponse_CanvasRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Read Free Draft
     * 读取独立草稿，修订 -1 表示尚未创建。
     * @returns ApiResponse_CanvasRead_ Successful Response
     * @throws ApiError
     */
    public static canvasDraftRead({
        canvasId,
    }: {
        canvasId: string,
    }): CancelablePromise<ApiResponse_CanvasRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/drafts/{canvas_id}',
            path: {
                'canvas_id': canvasId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Save Free Draft
     * 原子创建并保存首份有效内容；未知结果可重放原请求。
     * @returns ApiResponse_CanvasSaved_ Successful Response
     * @throws ApiError
     */
    public static canvasDraftSave({
        canvasId,
        requestBody,
    }: {
        canvasId: string,
        requestBody: CanvasSave,
    }): CancelablePromise<ApiResponse_CanvasSaved_> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/v1/studio/generation-canvases/drafts/{canvas_id}',
            path: {
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
     * Rename Canvas
     * 按修订重命名独立画布，复用完整保存校验。
     * @returns ApiResponse_CanvasRead_ Successful Response
     * @throws ApiError
     */
    public static canvasRename({
        canvasId,
        requestBody,
    }: {
        canvasId: string,
        requestBody: CanvasRename,
    }): CancelablePromise<ApiResponse_CanvasRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/name',
            path: {
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
     * Get Canvas
     * 读取当前文档。
     * @returns ApiResponse_CanvasRead_ Successful Response
     * @throws ApiError
     */
    public static canvasGet({
        canvasId,
        projectId = '',
    }: {
        canvasId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}',
            path: {
                'canvas_id': canvasId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        requestBody,
        projectId = '',
    }: {
        canvasId: string,
        requestBody: CanvasSave,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasSaved_> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/v1/studio/generation-canvases/{canvas_id}',
            path: {
                'canvas_id': canvasId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        expectedRevision,
        projectId = '',
    }: {
        canvasId: string,
        expectedRevision: number,
        projectId?: string,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/generation-canvases/{canvas_id}',
            path: {
                'canvas_id': canvasId,
            },
            query: {
                'expected_revision': expectedRevision,
                'project_id': projectId,
            },
            errors: {
                409: `Conflict`,
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Assistant History
     * Read the saved conversation for the requested canvas.
     * @returns ApiResponse_CanvasAssistantHistory_ Successful Response
     * @throws ApiError
     */
    public static canvasAssistantHistory({
        canvasId,
        projectId = '',
    }: {
        canvasId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasAssistantHistory_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/assistant',
            path: {
                'canvas_id': canvasId,
            },
            query: {
                'project_id': projectId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Send Assistant Message
     * Send a turn, replaying the receipt when the request already succeeded.
     * @returns ApiResponse_CanvasAssistantExchange_ Successful Response
     * @throws ApiError
     */
    public static canvasAssistantSend({
        canvasId,
        requestBody,
        projectId = '',
    }: {
        canvasId: string,
        requestBody: CanvasAssistantMessage,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasAssistantExchange_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/assistant',
            path: {
                'canvas_id': canvasId,
            },
            query: {
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
     * Get Model Capability
     * 核实画布归属后返回所选模型的真实输入与参数能力。
     * @returns ApiResponse_CanvasModelCapability_ Successful Response
     * @throws ApiError
     */
    public static canvasModelCapability({
        canvasId,
        modelId,
        projectId = '',
    }: {
        canvasId: string,
        modelId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasModelCapability_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/models/{model_id}/capability',
            path: {
                'canvas_id': canvasId,
                'model_id': modelId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        cardId,
        projectId = '',
    }: {
        canvasId: string,
        cardId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasCompiledInput_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/cards/{card_id}/compile',
            path: {
                'canvas_id': canvasId,
                'card_id': cardId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        requestBody,
        projectId = '',
    }: {
        canvasId: string,
        requestBody: CanvasPrecheckRequest,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasPrecheck_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/precheck',
            path: {
                'canvas_id': canvasId,
            },
            query: {
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
     * Submit Canvas Run
     * 原子受理并返回原或新运行；不在 HTTP 请求中调用供应商。
     * @returns ApiResponse_CanvasRunAccepted_ Successful Response
     * @throws ApiError
     */
    public static canvasRunSubmit({
        canvasId,
        requestBody,
        projectId = '',
    }: {
        canvasId: string,
        requestBody: CanvasRunSubmit,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasRunAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/runs',
            path: {
                'canvas_id': canvasId,
            },
            query: {
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
     * Get Canvas Runtime
     * 读取运行、累计正文和当前输出的一致切点。
     * @returns ApiResponse_CanvasSnapshot_ Successful Response
     * @throws ApiError
     */
    public static canvasRuntime({
        canvasId,
        projectId = '',
    }: {
        canvasId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasSnapshot_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/runtime',
            path: {
                'canvas_id': canvasId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        projectId = '',
    }: {
        canvasId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasStreamConnection_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/events/connection',
            path: {
                'canvas_id': canvasId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        cursor,
        projectId = '',
    }: {
        canvasId: string,
        cursor?: (number | null),
        projectId?: string,
    }): CancelablePromise<CanvasRuntimeEvent> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/events',
            path: {
                'canvas_id': canvasId,
            },
            query: {
                'cursor': cursor,
                'project_id': projectId,
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
        canvasId,
        runId,
        projectId = '',
    }: {
        canvasId: string,
        runId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasRunRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/runs/{run_id}/cancel',
            path: {
                'canvas_id': canvasId,
                'run_id': runId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        runId,
        nodeId,
        projectId = '',
    }: {
        canvasId: string,
        runId: string,
        nodeId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasRunRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/runs/{run_id}/nodes/{node_id}/cancel',
            path: {
                'canvas_id': canvasId,
                'run_id': runId,
                'node_id': nodeId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        runId,
        nodeId,
        position,
        projectId = '',
    }: {
        canvasId: string,
        runId: string,
        nodeId: string,
        position: number,
        projectId?: string,
    }): CancelablePromise<ApiResponse_Union_TextContentCard__ImageContentCard__VideoContentCard__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/runs/{run_id}/nodes/{node_id}/outputs/{position}/content',
            path: {
                'canvas_id': canvasId,
                'run_id': runId,
                'node_id': nodeId,
                'position': position,
            },
            query: {
                'project_id': projectId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Prepare Video Frame
     * 准备视频选帧素材，调用方可和采用关系一起保存。
     * @returns ApiResponse_ImageContentCard_ Successful Response
     * @throws ApiError
     */
    public static canvasPrepareVideoFrame({
        canvasId,
        requestBody,
        projectId = '',
    }: {
        canvasId: string,
        requestBody: CanvasVideoFrameRequest,
        projectId?: string,
    }): CancelablePromise<ApiResponse_ImageContentCard_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/video-frames',
            path: {
                'canvas_id': canvasId,
            },
            query: {
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
     * Get Card Outputs
     * 展示已保存修订的明确出口及直接候选，不修改绑定。
     * @returns ApiResponse_CanvasCardOutputs_ Successful Response
     * @throws ApiError
     */
    public static canvasCardOutputs({
        canvasId,
        cardId,
        projectId = '',
    }: {
        canvasId: string,
        cardId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasCardOutputs_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/cards/{card_id}/outputs',
            path: {
                'canvas_id': canvasId,
                'card_id': cardId,
            },
            query: {
                'project_id': projectId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Free Canvas Catalog
     * 新建独立画布使用与已有独立画布相同的卡片目录。
     * @returns ApiResponse_CanvasCatalog_ Successful Response
     * @throws ApiError
     */
    public static freeCanvasCatalog(): CancelablePromise<ApiResponse_CanvasCatalog_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/catalog/free',
        });
    }
    /**
     * Get Canvas Catalog
     * 核实画布归属后提供卡片、兼容用途、采用策略及单值输入约束。
     * @returns ApiResponse_CanvasCatalog_ Successful Response
     * @throws ApiError
     */
    public static canvasCatalog({
        canvasId,
        projectId = '',
    }: {
        canvasId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasCatalog_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/catalog',
            path: {
                'canvas_id': canvasId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        cardId,
        projectId = '',
    }: {
        canvasId: string,
        cardId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasCheckPreview_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/checks/{card_id}',
            path: {
                'canvas_id': canvasId,
                'card_id': cardId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        cardId,
        requestBody,
        projectId = '',
    }: {
        canvasId: string,
        cardId: string,
        requestBody: CanvasCheckRequest,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasCheckReportRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/checks/{card_id}/runs',
            path: {
                'canvas_id': canvasId,
                'card_id': cardId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        cardId,
        projectId = '',
    }: {
        canvasId: string,
        cardId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_list_CanvasCheckReportRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/checks/{card_id}/reports',
            path: {
                'canvas_id': canvasId,
                'card_id': cardId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        cardId,
        projectId = '',
    }: {
        canvasId: string,
        cardId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_list_CanvasCheckProduct__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/checks/{card_id}/products',
            path: {
                'canvas_id': canvasId,
                'card_id': cardId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        cardId,
        runId,
        nodeId,
        position,
        projectId = '',
    }: {
        canvasId: string,
        cardId: string,
        runId: string,
        nodeId: string,
        position: number,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasPostCheckPreview_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/checks/{card_id}/products/{run_id}/{node_id}/{position}',
            path: {
                'canvas_id': canvasId,
                'card_id': cardId,
                'run_id': runId,
                'node_id': nodeId,
                'position': position,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        cardId,
        runId,
        nodeId,
        position,
        requestBody,
        projectId = '',
    }: {
        canvasId: string,
        cardId: string,
        runId: string,
        nodeId: string,
        position: number,
        requestBody: CanvasPostCheckRequest,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasCheckReportRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/checks/{card_id}/products/{run_id}/{node_id}/{position}/runs',
            path: {
                'canvas_id': canvasId,
                'card_id': cardId,
                'run_id': runId,
                'node_id': nodeId,
                'position': position,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        cardId,
        reportId,
        projectId = '',
    }: {
        canvasId: string,
        cardId: string,
        reportId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasCheckReportRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/checks/{card_id}/reports/{report_id}/cancel',
            path: {
                'canvas_id': canvasId,
                'card_id': cardId,
                'report_id': reportId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        projectId = '',
    }: {
        canvasId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_list_CanvasCheckReportRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/check-reports/archived',
            path: {
                'canvas_id': canvasId,
            },
            query: {
                'project_id': projectId,
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
        canvasId,
        cardId,
        reportId,
        requestBody,
        projectId = '',
    }: {
        canvasId: string,
        cardId: string,
        reportId: string,
        requestBody: CanvasCheckRecheckRequest,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasCheckReportRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{canvas_id}/checks/{card_id}/reports/{report_id}/recheck',
            path: {
                'canvas_id': canvasId,
                'card_id': cardId,
                'report_id': reportId,
            },
            query: {
                'project_id': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Unprocessable Entity`,
            },
        });
    }
}
