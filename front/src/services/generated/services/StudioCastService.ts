/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ActorCreate } from '../models/ActorCreate';
import type { ActorUpdate } from '../models/ActorUpdate';
import type { ApiResponse_ActorRead_ } from '../models/ApiResponse_ActorRead_';
import type { ApiResponse_CharacterPropLinkRead_ } from '../models/ApiResponse_CharacterPropLinkRead_';
import type { ApiResponse_CharacterRead_ } from '../models/ApiResponse_CharacterRead_';
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { ApiResponse_PaginatedData_ActorRead__ } from '../models/ApiResponse_PaginatedData_ActorRead__';
import type { ApiResponse_PaginatedData_CharacterPropLinkRead__ } from '../models/ApiResponse_PaginatedData_CharacterPropLinkRead__';
import type { ApiResponse_PaginatedData_CharacterRead__ } from '../models/ApiResponse_PaginatedData_CharacterRead__';
import type { ApiResponse_PaginatedData_ShotCharacterLinkRead__ } from '../models/ApiResponse_PaginatedData_ShotCharacterLinkRead__';
import type { ApiResponse_ShotCharacterLinkRead_ } from '../models/ApiResponse_ShotCharacterLinkRead_';
import type { CharacterCreate } from '../models/CharacterCreate';
import type { CharacterPropLinkCreate } from '../models/CharacterPropLinkCreate';
import type { CharacterPropLinkUpdate } from '../models/CharacterPropLinkUpdate';
import type { CharacterUpdate } from '../models/CharacterUpdate';
import type { ShotCharacterLinkCreate } from '../models/ShotCharacterLinkCreate';
import type { ShotCharacterLinkUpdate } from '../models/ShotCharacterLinkUpdate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioCastService {
    /**
     * 演员列表（分页）
     * @returns ApiResponse_PaginatedData_ActorRead__ Successful Response
     * @throws ApiError
     */
    public static listActorsApiV1StudioCastActorsGet({
        projectId,
        q,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        /**
         * 按项目过滤；不传则包含全局+项目
         */
        projectId?: (string | null),
        /**
         * 关键字，过滤 name/description
         */
        q?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_ActorRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/cast/actors',
            query: {
                'project_id': projectId,
                'q': q,
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
     * 创建演员
     * @returns ApiResponse_ActorRead_ Successful Response
     * @throws ApiError
     */
    public static createActorApiV1StudioCastActorsPost({
        requestBody,
    }: {
        requestBody: ActorCreate,
    }): CancelablePromise<ApiResponse_ActorRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/cast/actors',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 获取演员
     * @returns ApiResponse_ActorRead_ Successful Response
     * @throws ApiError
     */
    public static getActorApiV1StudioCastActorsActorIdGet({
        actorId,
    }: {
        actorId: string,
    }): CancelablePromise<ApiResponse_ActorRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/cast/actors/{actor_id}',
            path: {
                'actor_id': actorId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新演员
     * @returns ApiResponse_ActorRead_ Successful Response
     * @throws ApiError
     */
    public static updateActorApiV1StudioCastActorsActorIdPatch({
        actorId,
        requestBody,
    }: {
        actorId: string,
        requestBody: ActorUpdate,
    }): CancelablePromise<ApiResponse_ActorRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/cast/actors/{actor_id}',
            path: {
                'actor_id': actorId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除演员
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteActorApiV1StudioCastActorsActorIdDelete({
        actorId,
    }: {
        actorId: string,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/cast/actors/{actor_id}',
            path: {
                'actor_id': actorId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 角色列表（分页）
     * @returns ApiResponse_PaginatedData_CharacterRead__ Successful Response
     * @throws ApiError
     */
    public static listCharactersApiV1StudioCastCharactersGet({
        projectId,
        q,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        /**
         * 按项目过滤
         */
        projectId?: (string | null),
        /**
         * 关键字，过滤 name/description
         */
        q?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_CharacterRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/cast/characters',
            query: {
                'project_id': projectId,
                'q': q,
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
     * 创建角色
     * @returns ApiResponse_CharacterRead_ Successful Response
     * @throws ApiError
     */
    public static createCharacterApiV1StudioCastCharactersPost({
        requestBody,
    }: {
        requestBody: CharacterCreate,
    }): CancelablePromise<ApiResponse_CharacterRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/cast/characters',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 获取角色
     * @returns ApiResponse_CharacterRead_ Successful Response
     * @throws ApiError
     */
    public static getCharacterApiV1StudioCastCharactersCharacterIdGet({
        characterId,
    }: {
        characterId: string,
    }): CancelablePromise<ApiResponse_CharacterRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/cast/characters/{character_id}',
            path: {
                'character_id': characterId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新角色
     * @returns ApiResponse_CharacterRead_ Successful Response
     * @throws ApiError
     */
    public static updateCharacterApiV1StudioCastCharactersCharacterIdPatch({
        characterId,
        requestBody,
    }: {
        characterId: string,
        requestBody: CharacterUpdate,
    }): CancelablePromise<ApiResponse_CharacterRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/cast/characters/{character_id}',
            path: {
                'character_id': characterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除角色
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteCharacterApiV1StudioCastCharactersCharacterIdDelete({
        characterId,
    }: {
        characterId: string,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/cast/characters/{character_id}',
            path: {
                'character_id': characterId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 角色-道具关联列表（分页）
     * @returns ApiResponse_PaginatedData_CharacterPropLinkRead__ Successful Response
     * @throws ApiError
     */
    public static listCharacterPropLinksApiV1StudioCastCharacterPropLinksGet({
        characterId,
        propId,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        characterId?: (string | null),
        propId?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_CharacterPropLinkRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/cast/character-prop-links',
            query: {
                'character_id': characterId,
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
     * 创建角色-道具关联
     * @returns ApiResponse_CharacterPropLinkRead_ Successful Response
     * @throws ApiError
     */
    public static createCharacterPropLinkApiV1StudioCastCharacterPropLinksPost({
        requestBody,
    }: {
        requestBody: CharacterPropLinkCreate,
    }): CancelablePromise<ApiResponse_CharacterPropLinkRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/cast/character-prop-links',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新角色-道具关联
     * @returns ApiResponse_CharacterPropLinkRead_ Successful Response
     * @throws ApiError
     */
    public static updateCharacterPropLinkApiV1StudioCastCharacterPropLinksLinkIdPatch({
        linkId,
        requestBody,
    }: {
        linkId: number,
        requestBody: CharacterPropLinkUpdate,
    }): CancelablePromise<ApiResponse_CharacterPropLinkRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/cast/character-prop-links/{link_id}',
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
     * 删除角色-道具关联
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteCharacterPropLinkApiV1StudioCastCharacterPropLinksLinkIdDelete({
        linkId,
    }: {
        linkId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/cast/character-prop-links/{link_id}',
            path: {
                'link_id': linkId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 镜头-角色关联列表（分页）
     * @returns ApiResponse_PaginatedData_ShotCharacterLinkRead__ Successful Response
     * @throws ApiError
     */
    public static listShotCharacterLinksApiV1StudioCastShotCharacterLinksGet({
        shotId,
        characterId,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        shotId?: (string | null),
        characterId?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_ShotCharacterLinkRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/cast/shot-character-links',
            query: {
                'shot_id': shotId,
                'character_id': characterId,
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
     * 创建镜头-角色关联
     * @returns ApiResponse_ShotCharacterLinkRead_ Successful Response
     * @throws ApiError
     */
    public static createShotCharacterLinkApiV1StudioCastShotCharacterLinksPost({
        requestBody,
    }: {
        requestBody: ShotCharacterLinkCreate,
    }): CancelablePromise<ApiResponse_ShotCharacterLinkRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/cast/shot-character-links',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新镜头-角色关联
     * @returns ApiResponse_ShotCharacterLinkRead_ Successful Response
     * @throws ApiError
     */
    public static updateShotCharacterLinkApiV1StudioCastShotCharacterLinksLinkIdPatch({
        linkId,
        requestBody,
    }: {
        linkId: number,
        requestBody: ShotCharacterLinkUpdate,
    }): CancelablePromise<ApiResponse_ShotCharacterLinkRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/cast/shot-character-links/{link_id}',
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
     * 删除镜头-角色关联
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteShotCharacterLinkApiV1StudioCastShotCharacterLinksLinkIdDelete({
        linkId,
    }: {
        linkId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/cast/shot-character-links/{link_id}',
            path: {
                'link_id': linkId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
