/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProductionShotView } from './ProductionShotView';
/**
 * 生产任务视图。
 */
export type ProductionJobView = {
    id: string;
    project_id: string;
    episode_id: string;
    status: string;
    current_stage: string;
    provider_mode: string;
    episode_package_hash: string;
    output_path: string;
    error_message: string;
    started_at?: (string | null);
    completed_at?: (string | null);
    shots?: Array<ProductionShotView>;
    manifest_path?: (string | null);
    final_output?: (string | null);
};

