/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 业务身份与显示节点分开；无稳定 ID 的目标只在该 revision 内有效。
 */
export type CanvasObject = {
    version_id: string;
    revision: number;
    kind: 'source' | 'design' | 'unit' | 'coverage' | 'reference' | 'dependency' | 'unit_config' | 'unit_basis' | 'instruction' | 'clip' | 'planned' | 'take' | 'seam';
    id: string;
    stable?: boolean;
    path?: Array<(string | number)>;
};
