/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneUnitDesignProposal } from './SceneUnitDesignProposal';
/**
 * 当前镜头的完整单元组织建议，身份和执行选择由服务端整体校验。
 */
export type SceneUnitDesignResult = {
    shot_id: string;
    target_model_id: string;
    organization: string;
    units: Array<SceneUnitDesignProposal>;
    missing?: Array<string>;
};
