/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ShootingNote } from './ShootingNote';
/**
 * 按原文版本保存的解释与报告引用。
 */
export type ShootingPreparation_Input = {
    notes?: Array<ShootingNote>;
    check_task_id?: (string | null);
    check_covered?: (boolean | null);
};
