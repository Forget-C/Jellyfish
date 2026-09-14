/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AIRequest } from '../models/AIRequest';
import type { ApiResponse_ChapterSequences_ } from '../models/ApiResponse_ChapterSequences_';
import type { ApiResponse_DirectingTaskRead_ } from '../models/ApiResponse_DirectingTaskRead_';
import type { ApiResponse_MediaRead_ } from '../models/ApiResponse_MediaRead_';
import type { ApiResponse_SequenceRead_ } from '../models/ApiResponse_SequenceRead_';
import type { ApiResponse_TaskAccepted_ } from '../models/ApiResponse_TaskAccepted_';
import type { ApiResponse_WorkspaceRead_ } from '../models/ApiResponse_WorkspaceRead_';
import type { ApplyDesignRequest } from '../models/ApplyDesignRequest';
import type { CompileRequest } from '../models/CompileRequest';
import type { ReviewDecisionRequest } from '../models/ReviewDecisionRequest';
import type { RevisionWrite } from '../models/RevisionWrite';
import type { SequenceCreate } from '../models/SequenceCreate';
import type { SequenceUpdate } from '../models/SequenceUpdate';
import type { ShootRequest } from '../models/ShootRequest';
import type { TakeReviewWrite } from '../models/TakeReviewWrite';
import type { VersionRequest } from '../models/VersionRequest';
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
}
