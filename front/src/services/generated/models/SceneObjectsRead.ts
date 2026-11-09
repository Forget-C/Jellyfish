/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetSummary } from './AssetSummary';
import type { SceneObjectRead } from './SceneObjectRead';
import type { SceneObjectTaskRead } from './SceneObjectTaskRead';
/**
 * 当前候选及项目资产，无待执行或已采用的画布输入。
 */
export type SceneObjectsRead = {
    revision: number;
    source_version?: (string | null);
    source_changed?: boolean;
    task?: (SceneObjectTaskRead | null);
    objects: Array<SceneObjectRead>;
    assets: Array<AssetSummary>;
};
