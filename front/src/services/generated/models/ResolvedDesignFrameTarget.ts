/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignField } from './DesignField';
import type { DesignFrameTarget } from './DesignFrameTarget';
/**
 * 只解析目标画面元信息，用于诊断和固定执行依据。
 */
export type ResolvedDesignFrameTarget = {
    target: DesignFrameTarget;
    available: boolean;
    label?: string;
    frame?: (DesignField | null);
};
