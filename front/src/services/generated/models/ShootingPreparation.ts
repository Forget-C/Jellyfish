/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ShootingNote } from './ShootingNote';
/**
 * 随场次版本保存的说明与报告引用；报告原文由任务保存。
 */
export type ShootingPreparation = {
    notes?: Array<ShootingNote>;
    check_task_id?: (string | null);
    check_covered?: (boolean | null);
};
