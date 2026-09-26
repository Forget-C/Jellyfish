/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 确定性生成的画像卡（同一实体在所有槽位共用，保证一致性）。
 */
export type EntityProfileCardRead = {
    name: string;
    entity_type: string;
    source: 'request' | 'project';
    /**
     * 画像描述
     */
    profile?: string;
    /**
     * 用于所有槽位的统一主体描述
     */
    canonical_subject?: string;
};

