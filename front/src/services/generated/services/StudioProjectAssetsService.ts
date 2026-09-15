/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { ApiResponse_PaginatedData_Any__ } from '../models/ApiResponse_PaginatedData_Any__';
import type { ApiResponse_ProjectActorLinkRead_ } from '../models/ApiResponse_ProjectActorLinkRead_';
import type { ApiResponse_ProjectCostumeLinkRead_ } from '../models/ApiResponse_ProjectCostumeLinkRead_';
import type { ApiResponse_ProjectPropLinkRead_ } from '../models/ApiResponse_ProjectPropLinkRead_';
import type { ApiResponse_ProjectSceneLinkRead_ } from '../models/ApiResponse_ProjectSceneLinkRead_';
import type { ProjectAssetLinkCreate } from '../models/ProjectAssetLinkCreate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioProjectAssetsService {
    /**
     * 项目-章节-实体关联列表（分页）
     * @returns ApiResponse_PaginatedData_Any__ Successful Response
     * @throws ApiError
     */
    public static listProjectEntityLinksApiV1StudioProjectAssetsEntityTypeGet({
        entityType,
        projectId,
        chapterId,
        assetId,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        entityType: string,
        projectId?: (string | null),
        chapterId?: (string | null),
        assetId?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_Any__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/project-assets/{entity_type}',
            path: {
                'entity_type': entityType,
            },
            query: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'asset_id': assetId,
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
     * 创建项目-章节-演员关联
     * @returns ApiResponse_ProjectActorLinkRead_ Successful Response
     * @throws ApiError
     */
    public static createProjectActorLinkApiV1StudioProjectAssetsActorPost({
        requestBody,
    }: {
        requestBody: ProjectAssetLinkCreate,
    }): CancelablePromise<ApiResponse_ProjectActorLinkRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/project-assets/actor',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除项目-章节-演员关联
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteProjectActorLinkApiV1StudioProjectAssetsActorLinkIdDelete({
        linkId,
    }: {
        linkId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/project-assets/actor/{link_id}',
            path: {
                'link_id': linkId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 创建项目-章节-场景关联
     * @returns ApiResponse_ProjectSceneLinkRead_ Successful Response
     * @throws ApiError
     */
    public static createProjectSceneLinkApiV1StudioProjectAssetsScenePost({
        requestBody,
    }: {
        requestBody: ProjectAssetLinkCreate,
    }): CancelablePromise<ApiResponse_ProjectSceneLinkRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/project-assets/scene',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除项目-章节-场景关联
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteProjectSceneLinkApiV1StudioProjectAssetsSceneLinkIdDelete({
        linkId,
    }: {
        linkId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/project-assets/scene/{link_id}',
            path: {
                'link_id': linkId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 创建项目-章节-道具关联
     * @returns ApiResponse_ProjectPropLinkRead_ Successful Response
     * @throws ApiError
     */
    public static createProjectPropLinkApiV1StudioProjectAssetsPropPost({
        requestBody,
    }: {
        requestBody: ProjectAssetLinkCreate,
    }): CancelablePromise<ApiResponse_ProjectPropLinkRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/project-assets/prop',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除项目-章节-道具关联
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteProjectPropLinkApiV1StudioProjectAssetsPropLinkIdDelete({
        linkId,
    }: {
        linkId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/project-assets/prop/{link_id}',
            path: {
                'link_id': linkId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 创建项目-章节-服装关联
     * @returns ApiResponse_ProjectCostumeLinkRead_ Successful Response
     * @throws ApiError
     */
    public static createProjectCostumeLinkApiV1StudioProjectAssetsCostumePost({
        requestBody,
    }: {
        requestBody: ProjectAssetLinkCreate,
    }): CancelablePromise<ApiResponse_ProjectCostumeLinkRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/project-assets/costume',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除项目-章节-服装关联
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteProjectCostumeLinkApiV1StudioProjectAssetsCostumeLinkIdDelete({
        linkId,
    }: {
        linkId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/project-assets/costume/{link_id}',
            path: {
                'link_id': linkId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
