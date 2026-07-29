/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReferenceAsset } from './ReferenceAsset';
/**
 * Bible 版本与参考资产集合。
 */
export type References = {
    /**
     * Bible 版本，如 1.0
     */
    bible_version?: (string | null);
    /**
     * 治理决策，如 ADR-015
     */
    canon_decision?: (string | null);
    /**
     * 角色参考
     */
    characters?: Array<ReferenceAsset>;
    /**
     * 环境参考
     */
    environments?: Array<ReferenceAsset>;
    /**
     * 道具参考
     */
    props?: Array<ReferenceAsset>;
};

