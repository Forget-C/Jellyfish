/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DivisionHistoryEntry } from './DivisionHistoryEntry';
import type { DivisionVersionRef } from './DivisionVersionRef';
export type DivisionHistoryPage = {
    items: Array<DivisionHistoryEntry>;
    active_task_ids?: Array<string>;
    total: number;
    page: number;
    page_size: number;
    current_version: (DivisionVersionRef | null);
};
