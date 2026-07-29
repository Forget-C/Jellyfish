/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ActorAsset } from './ActorAsset';
import type { CostumeAsset } from './CostumeAsset';
import type { PropAsset } from './PropAsset';
import type { SceneAsset } from './SceneAsset';
/**
 * 一集的素材库：演员 / 场景 / 道具 / 服装。
 */
export type AssetLibrary = {
    /**
     * 演员素材列表
     */
    actors?: Array<ActorAsset>;
    /**
     * 场景素材列表
     */
    scenes?: Array<SceneAsset>;
    /**
     * 道具素材列表
     */
    props?: Array<PropAsset>;
    /**
     * 服装素材列表
     */
    costumes?: Array<CostumeAsset>;
};

