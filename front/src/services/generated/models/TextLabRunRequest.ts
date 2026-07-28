/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 提交一轮文本实验的用户输入；会话和交付方式由固定路径绑定。
 */
export type TextLabRunRequest = {
    /**
     * 已登记的文本模型 ID
     */
    model_id: string;
    /**
     * 本轮用户输入，不接受客户端拼装的历史消息
     */
    content: string;
};

