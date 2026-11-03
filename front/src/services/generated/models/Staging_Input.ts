/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
import type { StagingActivity_Input } from './StagingActivity_Input';
/**
 * 独立镜内执行工作单；允许有理由的安静场面。
 */
export type Staging_Input = {
    activities: Array<StagingActivity_Input>;
    environment: Note_Input;
    intentional_absence: Note_Input;
};
