/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * 接收端明确采用的唯一来源记录，提示词通过身份引用它。
 */
export type InputBinding = {
    id: string;
    source: OutputIdentity;
    input_port: string;
};
