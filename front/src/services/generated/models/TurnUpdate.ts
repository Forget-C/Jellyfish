/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ExperimentMessageRead } from './ExperimentMessageRead';
export type TurnUpdate = {
    text: string;
    error: (string | null);
    reason: (string | null);
    error_code?: (string | null);
    message?: (ExperimentMessageRead | null);
};
