/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * 明确前后态是可定位状态，变化仍完整保留。
 */
export type ContinuityFields = {
    before?: ReferenceDesignField;
    change?: ReferenceDesignField;
    after?: ReferenceDesignField;
    following_constraints?: ReferenceDesignField;
};
