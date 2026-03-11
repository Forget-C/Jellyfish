/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { ApiResponse_PaginatedData_ShotActorImageLinkRead__ } from '../models/ApiResponse_PaginatedData_ShotActorImageLinkRead__';
import type { ApiResponse_PaginatedData_ShotCostumeLinkRead__ } from '../models/ApiResponse_PaginatedData_ShotCostumeLinkRead__';
import type { ApiResponse_PaginatedData_ShotPropLinkRead__ } from '../models/ApiResponse_PaginatedData_ShotPropLinkRead__';
import type { ApiResponse_PaginatedData_ShotSceneLinkRead__ } from '../models/ApiResponse_PaginatedData_ShotSceneLinkRead__';
import type { ApiResponse_ShotActorImageLinkRead_ } from '../models/ApiResponse_ShotActorImageLinkRead_';
import type { ApiResponse_ShotCostumeLinkRead_ } from '../models/ApiResponse_ShotCostumeLinkRead_';
import type { ApiResponse_ShotPropLinkRead_ } from '../models/ApiResponse_ShotPropLinkRead_';
import type { ApiResponse_ShotSceneLinkRead_ } from '../models/ApiResponse_ShotSceneLinkRead_';
import type { ShotAssetLinkCreate } from '../models/ShotAssetLinkCreate';
import type { ShotLinkUpdate } from '../models/ShotLinkUpdate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioShotLinksService {
    /**
     * 镜头-演员形象关联列表（分页）
     * @returns ApiResponse_PaginatedData_ShotActorImageLinkRead__ Successful Response
     * @throws ApiError
     */
    public static listShotActorImageLinksApiV1StudioShotLinksActorImageGet({
        shotId,
        actorImageId,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        shotId?: (string | null),
        actorImageId?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_ShotActorImageLinkRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/shot-links/actor-image',
            query: {
                'shot_id': shotId,
                'actor_image_id': actorImageId,
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
     * 创建镜头-演员形象关联
     * @returns ApiResponse_ShotActorImageLinkRead_ Successful Response
     * @throws ApiError
     */
    public static createShotActorImageLinkApiV1StudioShotLinksActorImagePost({
        requestBody,
    }: {
        requestBody: ShotAssetLinkCreate,
    }): CancelablePromise<ApiResponse_ShotActorImageLinkRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/shot-links/actor-image',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新镜头-演员形象关联
     * @returns ApiResponse_ShotActorImageLinkRead_ Successful Response
     * @throws ApiError
     */
    public static updateShotActorImageLinkApiV1StudioShotLinksActorImageLinkIdPatch({
        linkId,
        requestBody,
    }: {
        linkId: number,
        requestBody: ShotLinkUpdate,
    }): CancelablePromise<ApiResponse_ShotActorImageLinkRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/shot-links/actor-image/{link_id}',
            path: {
                'link_id': linkId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除镜头-演员形象关联
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteShotActorImageLinkApiV1StudioShotLinksActorImageLinkIdDelete({
        linkId,
    }: {
        linkId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/shot-links/actor-image/{link_id}',
            path: {
                'link_id': linkId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 镜头-场景关联列表（分页）
     * @returns ApiResponse_PaginatedData_ShotSceneLinkRead__ Successful Response
     * @throws ApiError
     */
    public static listShotSceneLinksApiV1StudioShotLinksSceneGet({
        shotId,
        sceneId,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        shotId?: (string | null),
        sceneId?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_ShotSceneLinkRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/shot-links/scene',
            query: {
                'shot_id': shotId,
                'scene_id': sceneId,
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
     * 创建镜头-场景关联
     * @returns ApiResponse_ShotSceneLinkRead_ Successful Response
     * @throws ApiError
     */
    public static createShotSceneLinkApiV1StudioShotLinksScenePost({
        requestBody,
    }: {
        requestBody: ShotAssetLinkCreate,
    }): CancelablePromise<ApiResponse_ShotSceneLinkRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/shot-links/scene',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新镜头-场景关联
     * @returns ApiResponse_ShotSceneLinkRead_ Successful Response
     * @throws ApiError
     */
    public static updateShotSceneLinkApiV1StudioShotLinksSceneLinkIdPatch({
        linkId,
        requestBody,
    }: {
        linkId: number,
        requestBody: ShotLinkUpdate,
    }): CancelablePromise<ApiResponse_ShotSceneLinkRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/shot-links/scene/{link_id}',
            path: {
                'link_id': linkId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除镜头-场景关联
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteShotSceneLinkApiV1StudioShotLinksSceneLinkIdDelete({
        linkId,
    }: {
        linkId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/shot-links/scene/{link_id}',
            path: {
                'link_id': linkId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 镜头-道具关联列表（分页）
     * @returns ApiResponse_PaginatedData_ShotPropLinkRead__ Successful Response
     * @throws ApiError
     */
    public static listShotPropLinksApiV1StudioShotLinksPropGet({
        shotId,
        propId,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        shotId?: (string | null),
        propId?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_ShotPropLinkRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/shot-links/prop',
            query: {
                'shot_id': shotId,
                'prop_id': propId,
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
     * 创建镜头-道具关联
     * @returns ApiResponse_ShotPropLinkRead_ Successful Response
     * @throws ApiError
     */
    public static createShotPropLinkApiV1StudioShotLinksPropPost({
        requestBody,
    }: {
        requestBody: ShotAssetLinkCreate,
    }): CancelablePromise<ApiResponse_ShotPropLinkRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/shot-links/prop',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新镜头-道具关联
     * @returns ApiResponse_ShotPropLinkRead_ Successful Response
     * @throws ApiError
     */
    public static updateShotPropLinkApiV1StudioShotLinksPropLinkIdPatch({
        linkId,
        requestBody,
    }: {
        linkId: number,
        requestBody: ShotLinkUpdate,
    }): CancelablePromise<ApiResponse_ShotPropLinkRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/shot-links/prop/{link_id}',
            path: {
                'link_id': linkId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除镜头-道具关联
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteShotPropLinkApiV1StudioShotLinksPropLinkIdDelete({
        linkId,
    }: {
        linkId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/shot-links/prop/{link_id}',
            path: {
                'link_id': linkId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 镜头-服装关联列表（分页）
     * @returns ApiResponse_PaginatedData_ShotCostumeLinkRead__ Successful Response
     * @throws ApiError
     */
    public static listShotCostumeLinksApiV1StudioShotLinksCostumeGet({
        shotId,
        costumeId,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        shotId?: (string | null),
        costumeId?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_ShotCostumeLinkRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/shot-links/costume',
            query: {
                'shot_id': shotId,
                'costume_id': costumeId,
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
     * 创建镜头-服装关联
     * @returns ApiResponse_ShotCostumeLinkRead_ Successful Response
     * @throws ApiError
     */
    public static createShotCostumeLinkApiV1StudioShotLinksCostumePost({
        requestBody,
    }: {
        requestBody: ShotAssetLinkCreate,
    }): CancelablePromise<ApiResponse_ShotCostumeLinkRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/shot-links/costume',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新镜头-服装关联
     * @returns ApiResponse_ShotCostumeLinkRead_ Successful Response
     * @throws ApiError
     */
    public static updateShotCostumeLinkApiV1StudioShotLinksCostumeLinkIdPatch({
        linkId,
        requestBody,
    }: {
        linkId: number,
        requestBody: ShotLinkUpdate,
    }): CancelablePromise<ApiResponse_ShotCostumeLinkRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/shot-links/costume/{link_id}',
            path: {
                'link_id': linkId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除镜头-服装关联
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteShotCostumeLinkApiV1StudioShotLinksCostumeLinkIdDelete({
        linkId,
    }: {
        linkId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/shot-links/costume/{link_id}',
            path: {
                'link_id': linkId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
