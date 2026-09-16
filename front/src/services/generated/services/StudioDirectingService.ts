/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AIRequest } from '../models/AIRequest';
import type { ApiResponse_BatchRead_ } from '../models/ApiResponse_BatchRead_';
import type { ApiResponse_ChapterAssemblyRead_ } from '../models/ApiResponse_ChapterAssemblyRead_';
import type { ApiResponse_ChapterSequences_ } from '../models/ApiResponse_ChapterSequences_';
import type { ApiResponse_ContinuityRead_ } from '../models/ApiResponse_ContinuityRead_';
import type { ApiResponse_CutFrameRead_ } from '../models/ApiResponse_CutFrameRead_';
import type { ApiResponse_DirectingTaskRead_ } from '../models/ApiResponse_DirectingTaskRead_';
import type { ApiResponse_ExtractedFrame_ } from '../models/ApiResponse_ExtractedFrame_';
import type { ApiResponse_FeedbackRead_ } from '../models/ApiResponse_FeedbackRead_';
import type { ApiResponse_LedgerRead_ } from '../models/ApiResponse_LedgerRead_';
import type { ApiResponse_list_AssetSummary__ } from '../models/ApiResponse_list_AssetSummary__';
import type { ApiResponse_list_BatchRead__ } from '../models/ApiResponse_list_BatchRead__';
import type { ApiResponse_list_ProjectStyleRevision__ } from '../models/ApiResponse_list_ProjectStyleRevision__';
import type { ApiResponse_list_SourceRead__ } from '../models/ApiResponse_list_SourceRead__';
import type { ApiResponse_MediaRead_ } from '../models/ApiResponse_MediaRead_';
import type { ApiResponse_SequenceRead_ } from '../models/ApiResponse_SequenceRead_';
import type { ApiResponse_TaskAccepted_ } from '../models/ApiResponse_TaskAccepted_';
import type { ApiResponse_WorkspaceRead_ } from '../models/ApiResponse_WorkspaceRead_';
import type { ApplyDesignRequest } from '../models/ApplyDesignRequest';
import type { AssetCreateRequest } from '../models/AssetCreateRequest';
import type { BatchPrepare } from '../models/BatchPrepare';
import type { CompileRequest } from '../models/CompileRequest';
import type { CutFrameRequest } from '../models/CutFrameRequest';
import type { ExtractFrameRequest } from '../models/ExtractFrameRequest';
import type { FeedbackWrite } from '../models/FeedbackWrite';
import type { RegroupRequest } from '../models/RegroupRequest';
import type { RepairPlanRequest } from '../models/RepairPlanRequest';
import type { ReviewDecisionRequest } from '../models/ReviewDecisionRequest';
import type { RevisionWrite } from '../models/RevisionWrite';
import type { SeamReviewRequest } from '../models/SeamReviewRequest';
import type { SequenceCreate } from '../models/SequenceCreate';
import type { SequenceUpdate } from '../models/SequenceUpdate';
import type { ShootRequest } from '../models/ShootRequest';
import type { SourceResolveRequest } from '../models/SourceResolveRequest';
import type { StyleWrite } from '../models/StyleWrite';
import type { TakeReviewWrite } from '../models/TakeReviewWrite';
import type { TransitionWrite_Input } from '../models/TransitionWrite_Input';
import type { VersionRequest } from '../models/VersionRequest';
import type { VisualRequest } from '../models/VisualRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioDirectingService {
    /**
     * Chapter
     * 返回章节原文和有序场次。
     * @returns ApiResponse_ChapterSequences_ Successful Response
     * @throws ApiError
     */
    public static directingChapter({
        projectId,
        chapterId,
    }: {
        projectId: string,
        chapterId: string,
    }): CancelablePromise<ApiResponse_ChapterSequences_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Sequence
     * 确认一段原文为正式场次。
     * @returns ApiResponse_SequenceRead_ Successful Response
     * @throws ApiError
     */
    public static directingCreateSequence({
        projectId,
        chapterId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        requestBody: SequenceCreate,
    }): CancelablePromise<ApiResponse_SequenceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Update Sequence
     * 修改场次范围或顺序，旧版本更新返回冲突。
     * @returns ApiResponse_SequenceRead_ Successful Response
     * @throws ApiError
     */
    public static directingUpdateSequence({
        projectId,
        chapterId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        requestBody: SequenceUpdate,
    }): CancelablePromise<ApiResponse_SequenceRead_> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Workspace
     * 三视图读取同一份场次上下文。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingWorkspace({
        projectId,
        sequenceId,
    }: {
        projectId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Resolve Sources
     * 批量只读解析来源，归属与历史匹配规则由领域服务维护。
     * @returns ApiResponse_list_SourceRead__ Successful Response
     * @throws ApiError
     */
    public static directingResolveSources({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: SourceResolveRequest,
    }): CancelablePromise<ApiResponse_list_SourceRead__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/sources/resolve',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Save Revision
     * 保存设计、计划或粗剪草稿。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingSaveRevision({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: RevisionWrite,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/revisions',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Confirm Revision
     * 登记本地单用户工作台的显式确认动作。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingConfirmRevision({
        projectId,
        sequenceId,
        revisionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        revisionId: string,
        requestBody: VersionRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/revisions/{revision_id}/confirm',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'revision_id': revisionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Analyze
     * 提交原文划场建议，结果通过通用任务查询。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingAnalyzeChapter({
        projectId,
        chapterId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        requestBody: AIRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/analyze',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Design
     * 提交带起始版本的六岗导演设计建议。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingGenerateDesign({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: AIRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/design',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Apply Design
     * 显式采用已完成任务建议，迟到结果保留为独立草稿。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingApplyDesign({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: ApplyDesignRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/design/apply',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Compile Unit
     * 明确授权编译所选单元，生成不可变提示词。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingCompile({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: CompileRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/compile',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Review
     * 对固定提示词提交六岗联合审查。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingReview({
        projectId,
        sequenceId,
        promptId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        promptId: string,
        requestBody: AIRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/prompts/{prompt_id}/review',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'prompt_id': promptId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Apply Review
     * 保存实际审稿结论供用户查看、修改方案或选择执行。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingApplyReview({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: ApplyDesignRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/review/apply',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Shoot
     * 确认固定输入并开始单元试拍，重复请求返回同一任务。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingShoot({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: ShootRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/shoot',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Annotate Take
     * 保存过保修废、实际覆盖和保留区间。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingAnnotateTake({
        projectId,
        sequenceId,
        takeId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        takeId: string,
        requestBody: TakeReviewWrite,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/takes/{take_id}',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'take_id': takeId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Take Media
     * 返回经归属校验的播放器地址，前端不自行拼接后端接口。
     * @returns ApiResponse_MediaRead_ Successful Response
     * @throws ApiError
     */
    public static directingTakeMedia({
        projectId,
        sequenceId,
        takeId,
    }: {
        projectId: string,
        sequenceId: string,
        takeId: string,
    }): CancelablePromise<ApiResponse_MediaRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/takes/{take_id}/media',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'take_id': takeId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Resolve Review
     * 派生保留人工取舍的审稿版本，原报告保持不变。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingResolveReview({
        projectId,
        sequenceId,
        reviewId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        reviewId: string,
        requestBody: ReviewDecisionRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/reviews/{review_id}/resolve',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'review_id': reviewId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Task Detail
     * 读取当前项目的导演建议和错误，保持业务结果在场次面板。
     * @returns ApiResponse_DirectingTaskRead_ Successful Response
     * @throws ApiError
     */
    public static directingTask({
        projectId,
        taskId,
    }: {
        projectId: string,
        taskId: string,
    }): CancelablePromise<ApiResponse_DirectingTaskRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/tasks/{task_id}',
            path: {
                'project_id': projectId,
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Styles
     * 读取项目的候选与确认风格版本。
     * @returns ApiResponse_list_ProjectStyleRevision__ Successful Response
     * @throws ApiError
     */
    public static directingStyles({
        projectId,
    }: {
        projectId: string,
    }): CancelablePromise<ApiResponse_list_ProjectStyleRevision__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/styles',
            path: {
                'project_id': projectId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Save Style
     * 保存或派生风格草稿，不自动启用。
     * @returns ApiResponse_list_ProjectStyleRevision__ Successful Response
     * @throws ApiError
     */
    public static directingSaveStyle({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: StyleWrite,
    }): CancelablePromise<ApiResponse_list_ProjectStyleRevision__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/styles',
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
     * Confirm Style
     * 记录人工确认的项目风格版本。
     * @returns ApiResponse_list_ProjectStyleRevision__ Successful Response
     * @throws ApiError
     */
    public static directingConfirmStyle({
        projectId,
        revisionId,
        requestBody,
    }: {
        projectId: string,
        revisionId: string,
        requestBody: VersionRequest,
    }): CancelablePromise<ApiResponse_list_ProjectStyleRevision__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/styles/{revision_id}/confirm',
            path: {
                'project_id': projectId,
                'revision_id': revisionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Generate Visual
     * 提交基于已确认设计的验证图，产物保留为候选。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingGenerateVisual({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: VisualRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/images',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Assets
     * 返回当前项目内可关联的角色、场所与道具。
     * @returns ApiResponse_list_AssetSummary__ Successful Response
     * @throws ApiError
     */
    public static directingAssets({
        projectId,
    }: {
        projectId: string,
    }): CancelablePromise<ApiResponse_list_AssetSummary__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/assets',
            path: {
                'project_id': projectId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Asset
     * 在场次内按需创建项目资产，身份绑定仍由用户明确选择。
     * @returns ApiResponse_list_AssetSummary__ Successful Response
     * @throws ApiError
     */
    public static directingCreateAsset({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: AssetCreateRequest,
    }): CancelablePromise<ApiResponse_list_AssetSummary__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/assets',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Extract Frame
     * 从已归档 Take 的真实位置提取连续性参考图。
     * @returns ApiResponse_ExtractedFrame_ Successful Response
     * @throws ApiError
     */
    public static directingExtractFrame({
        projectId,
        sequenceId,
        takeId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        takeId: string,
        requestBody: ExtractFrameRequest,
    }): CancelablePromise<ApiResponse_ExtractedFrame_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/takes/{take_id}/frame',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'take_id': takeId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Prepare Batch
     * 固定本轮选择并返回逐项预检，不执行模型请求。
     * @returns ApiResponse_BatchRead_ Successful Response
     * @throws ApiError
     */
    public static directingPrepareBatch({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: BatchPrepare,
    }): CancelablePromise<ApiResponse_BatchRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/batches/prepare',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Batches
     * 恢复本场固定批次及各项通用任务状态。
     * @returns ApiResponse_list_BatchRead__ Successful Response
     * @throws ApiError
     */
    public static directingBatches({
        projectId,
        sequenceId,
    }: {
        projectId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_list_BatchRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/batches',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Submit Batch
     * 显式受理已预检批次，重复请求不会新增任务。
     * @returns ApiResponse_BatchRead_ Successful Response
     * @throws ApiError
     */
    public static directingSubmitBatch({
        projectId,
        sequenceId,
        batchId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        batchId: string,
        requestBody: VersionRequest,
    }): CancelablePromise<ApiResponse_BatchRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/batches/{batch_id}/submit',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'batch_id': batchId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Regroup Units
     * 显式拆分/组合产生新计划草稿，原计划和已有素材保持不变。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingRegroupUnits({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: RegroupRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/regroup',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Continuity
     * 返回当前真实连续性与局部失效状态。
     * @returns ApiResponse_ContinuityRead_ Successful Response
     * @throws ApiError
     */
    public static directingContinuity({
        projectId,
        sequenceId,
    }: {
        projectId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_ContinuityRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/continuity',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Cut Frame
     * 从已确认采用区间提帧并固定来源。
     * @returns ApiResponse_CutFrameRead_ Successful Response
     * @throws ApiError
     */
    public static directingCutFrame({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: CutFrameRequest,
    }): CancelablePromise<ApiResponse_CutFrameRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/cut-frames',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Review Seam
     * 保存针对真实相邻片段的人工接缝结论。
     * @returns ApiResponse_ContinuityRead_ Successful Response
     * @throws ApiError
     */
    public static directingReviewSeam({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: SeamReviewRequest,
    }): CancelablePromise<ApiResponse_ContinuityRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/seam-reviews',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Feedback
     * 返回当前验收、返工与经验候选的持久版本。
     * @returns ApiResponse_FeedbackRead_ Successful Response
     * @throws ApiError
     */
    public static directingFeedback({
        projectId,
        sequenceId,
    }: {
        projectId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_FeedbackRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/feedback',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Save Feedback
     * 保存强类型反馈草稿，艺术判断由其来源承担。
     * @returns ApiResponse_FeedbackRead_ Successful Response
     * @throws ApiError
     */
    public static directingSaveFeedback({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: FeedbackWrite,
    }): CancelablePromise<ApiResponse_FeedbackRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/feedback',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Confirm Feedback
     * 显式确认当前反馈草稿，旧采用上的审片不能成为当前验收。
     * @returns ApiResponse_FeedbackRead_ Successful Response
     * @throws ApiError
     */
    public static directingConfirmFeedback({
        projectId,
        sequenceId,
        revisionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        revisionId: string,
        requestBody: VersionRequest,
    }): CancelablePromise<ApiResponse_FeedbackRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/feedback/{revision_id}/confirm',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'revision_id': revisionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Ledger
     * 只读汇总三本账，不提供第二份台账编辑入口。
     * @returns ApiResponse_LedgerRead_ Successful Response
     * @throws ApiError
     */
    public static directingLedger({
        projectId,
        sequenceId,
    }: {
        projectId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_LedgerRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/ledger',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Chapter Assembly
     * 查询章节顺序播放依据、验收缺口与跨场审查。
     * @returns ApiResponse_ChapterAssemblyRead_ Successful Response
     * @throws ApiError
     */
    public static directingChapterAssembly({
        projectId,
        chapterId,
    }: {
        projectId: string,
        chapterId: string,
    }): CancelablePromise<ApiResponse_ChapterAssemblyRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/assembly',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Review Transition
     * 保存人工跨场审查，校验相邻顺序及实际边界。
     * @returns ApiResponse_ChapterAssemblyRead_ Successful Response
     * @throws ApiError
     */
    public static directingReviewTransition({
        projectId,
        chapterId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        requestBody: TransitionWrite_Input,
    }): CancelablePromise<ApiResponse_ChapterAssemblyRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/transitions',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Knowledge Style
     * 从已确认经验显式准备项目风格草稿，未自动确认或应用。
     * @returns ApiResponse_list_ProjectStyleRevision__ Successful Response
     * @throws ApiError
     */
    public static directingKnowledgeStyle({
        projectId,
        sequenceId,
        revisionId,
    }: {
        projectId: string,
        sequenceId: string,
        revisionId: string,
    }): CancelablePromise<ApiResponse_list_ProjectStyleRevision__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/knowledge/{revision_id}/style',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'revision_id': revisionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Prepare Repair Plan
     * 从确认的返工单创建显式局部生产草稿，继续走正常确认、编译和执行。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingPrepareRepairPlan({
        projectId,
        sequenceId,
        revisionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        revisionId: string,
        requestBody: RepairPlanRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/repairs/{revision_id}/plan',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'revision_id': revisionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
