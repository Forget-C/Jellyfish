/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_TaskCancelRead_ } from '../models/ApiResponse_TaskCancelRead_';
import type { ApiResponse_TaskOutputPageRead_ } from '../models/ApiResponse_TaskOutputPageRead_';
import type { ApiResponse_TaskPageRead_ } from '../models/ApiResponse_TaskPageRead_';
import type { ApiResponse_TaskResultRead_ } from '../models/ApiResponse_TaskResultRead_';
import type { ApiResponse_TaskStatusRead_ } from '../models/ApiResponse_TaskStatusRead_';
import type { TaskCancelRequest } from '../models/TaskCancelRequest';
import type { TaskStatus } from '../models/TaskStatus';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class FilmService {
    /**
     * 任务历史与活动任务列表
     * 按创建时间游标查询，不默认隐藏历史；日期范围为前闭后开。
     * @returns ApiResponse_TaskPageRead_ Successful Response
     * @throws ApiError
     */
    public static listTasksApiV1FilmTasksGet({
        statuses,
        taskKind,
        targetType,
        targetId,
        projectId,
        createdFrom,
        createdBefore,
        recentSeconds,
        cursor,
        limit = 50,
    }: {
        statuses?: (Array<TaskStatus> | null),
        taskKind?: (string | null),
        targetType?: (string | null),
        targetId?: (string | null),
        projectId?: (string | null),
        createdFrom?: (string | null),
        createdBefore?: (string | null),
        recentSeconds?: (number | null),
        cursor?: (string | null),
        limit?: number,
    }): CancelablePromise<ApiResponse_TaskPageRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/film/tasks',
            query: {
                'statuses': statuses,
                'task_kind': taskKind,
                'target_type': targetType,
                'target_id': targetId,
                'project_id': projectId,
                'created_from': createdFrom,
                'created_before': createdBefore,
                'recent_seconds': recentSeconds,
                'cursor': cursor,
                'limit': limit,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 查询业务目标的生成产物历史
     * 业务面板按目标读取输出；实际采用操作仍由对应业务接口完成。
     * @returns ApiResponse_TaskOutputPageRead_ Successful Response
     * @throws ApiError
     */
    public static listTaskOutputsApiV1FilmTasksOutputsGet({
        targetType,
        targetId,
        cursor,
        limit = 100,
    }: {
        targetType: string,
        targetId: string,
        cursor?: (string | null),
        limit?: number,
    }): CancelablePromise<ApiResponse_TaskOutputPageRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/film/tasks/outputs',
            query: {
                'target_type': targetType,
                'target_id': targetId,
                'cursor': cursor,
                'limit': limit,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 查询任务状态与进度
     * 直接返回主表轻量状态。
     * @returns ApiResponse_TaskStatusRead_ Successful Response
     * @throws ApiError
     */
    public static getTaskStatusApiV1FilmTasksTaskIdStatusGet({
        taskId,
    }: {
        taskId: string,
    }): CancelablePromise<ApiResponse_TaskStatusRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/film/tasks/{task_id}/status',
            path: {
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 查询任务结果
     * 业务面板按需读取任务结果和已保存的部分产物。
     * @returns ApiResponse_TaskResultRead_ Successful Response
     * @throws ApiError
     */
    public static getTaskResultApiV1FilmTasksTaskIdResultGet({
        taskId,
    }: {
        taskId: string,
    }): CancelablePromise<ApiResponse_TaskResultRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/film/tasks/{task_id}/result',
            path: {
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 请求取消任务
     * 仅调用统一维护入口；排队任务可立即取消，运行任务登记取消意图。
     * @returns ApiResponse_TaskCancelRead_ Successful Response
     * @throws ApiError
     */
    public static cancelTaskApiV1FilmTasksTaskIdCancelPost({
        taskId,
        requestBody,
    }: {
        taskId: string,
        requestBody: TaskCancelRequest,
    }): CancelablePromise<ApiResponse_TaskCancelRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/film/tasks/{task_id}/cancel',
            path: {
                'task_id': taskId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
