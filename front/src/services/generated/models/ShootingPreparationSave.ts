/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ShootingPreparation } from './ShootingPreparation';
/**
 * 即时保存采用并发版本和幂等身份。
 */
export type ShootingPreparationSave = {
    request_id: string;
    expected_version: number;
    preparation: ShootingPreparation;
};
