/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EntityNameExistenceItem } from './EntityNameExistenceItem';
/**
 * 批量存在性检测结果（按资产类型分组）。
 */
export type EntityNameExistenceCheckResponse = {
    characters?: Array<EntityNameExistenceItem>;
    props?: Array<EntityNameExistenceItem>;
    scenes?: Array<EntityNameExistenceItem>;
    costumes?: Array<EntityNameExistenceItem>;
};

