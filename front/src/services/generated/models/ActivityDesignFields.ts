/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignField } from './DesignField';
/**
 * 镜内活动完整过程和明确时序。
 */
export type ActivityDesignFields = {
    task: DesignField;
    attention: DesignField;
    main_action_effect: DesignField;
    path: DesignField;
    delay_basis: DesignField;
    delay_ms?: (number | null);
    entry_exit: DesignField;
    exit_state: DesignField;
    depth: DesignField;
    intensity: DesignField;
};
