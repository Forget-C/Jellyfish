/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasResolvedOutput } from './CanvasResolvedOutput';
/**
 * 运行正文属于累计未完成成果，正式输出由结果集单独标识。
 */
export type CanvasNodeRead = {
    id: string;
    run_id: string;
    card_id: string;
    task_id: (string | null);
    status: string;
    stage: string;
    progress: (number | null);
    text: string;
    basis: Record<string, any>;
    outputs: Array<CanvasResolvedOutput>;
    result_set_id: (string | null);
    current_output_updated: boolean;
    automatic_check_card_ids?: Array<string>;
    error_code: (string | null);
    error_message: (string | null);
};
