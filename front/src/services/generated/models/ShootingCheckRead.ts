/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ShootingCheckReport } from './ShootingCheckReport';
import type { ShootingPreparation } from './ShootingPreparation';
export type ShootingCheckRead = {
    task_id: string;
    status: string;
    error?: (string | null);
    source_text: string;
    preparation: ShootingPreparation;
    report?: (ShootingCheckReport | null);
    basis_current?: boolean;
};
