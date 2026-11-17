/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ShootingPreparation } from './ShootingPreparation';
/**
 * 草稿可无场次数据库身份；检查冻结实际摘录和说明。
 */
export type ShootingCheckRequest = {
    request_id: string;
    draft_key: string;
    source_text: string;
    preparation?: ShootingPreparation;
    source_version?: (string | null);
    source_start?: (number | null);
    model_id?: (string | null);
};
