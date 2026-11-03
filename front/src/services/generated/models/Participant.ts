/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 场次内人物或物件身份；无名参与者无需创建全局资产。
 */
export type Participant = {
    id: string;
    name: string;
    /**
     * 可选默认角色资产，仅提供选材候选；单元可独立选择其他项目资产，不自动选入图片。
     */
    character_id?: (string | null);
    /**
     * 可选默认道具资产，仅提供选材候选，不限制单元参考来源。
     */
    prop_id?: (string | null);
};
