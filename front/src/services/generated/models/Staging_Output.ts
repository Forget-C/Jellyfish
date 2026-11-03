/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
import type { StagingActivity_Output } from './StagingActivity_Output';
/**
 * 独立镜内执行工作单；允许有理由的安静场面。
 */
export type Staging_Output = {
    activities: Array<StagingActivity_Output>;
    environment: Note_Output;
    intentional_absence: Note_Output;
};
