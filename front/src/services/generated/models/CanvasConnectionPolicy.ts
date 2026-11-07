/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 一个兼容端点组合的连接与解除语义；多用途必须明确采用。
 */
export type CanvasConnectionPolicy = {
    source_type: string;
    source_port: string;
    target_type: string;
    target_port: string;
    adoption_allowed: boolean;
    connect: 'candidate' | 'adopt_design' | 'associate_acceptance';
    cancel: 'keep_connection' | 'remove_connection';
    disconnect: 'protect' | 'release' | 'confirm_frame';
    message: string;
};
