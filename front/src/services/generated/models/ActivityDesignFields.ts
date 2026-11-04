/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * 镜内活动完整过程和明确时序。
 */
export type ActivityDesignFields = {
    task: ReferenceDesignField;
    attention: ReferenceDesignField;
    main_action_effect: ReferenceDesignField;
    path: ReferenceDesignField;
    delay_basis: ReferenceDesignField;
    delay_ms?: (number | null);
    entry_exit: ReferenceDesignField;
    exit_state: ReferenceDesignField;
    depth: ReferenceDesignField;
    intensity: ReferenceDesignField;
};
