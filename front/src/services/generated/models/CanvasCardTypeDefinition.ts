/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasDesignFieldDefinition } from './CanvasDesignFieldDefinition';
import type { CanvasInputPortDefinition } from './CanvasInputPortDefinition';
import type { CanvasOutputPortDefinition } from './CanvasOutputPortDefinition';
/**
 * 系统卡片类型的展示与端点声明，不包含供应商能力或执行状态。
 */
export type CanvasCardTypeDefinition = {
    type: string;
    type_version?: number;
    title: string;
    group: '基础内容' | '模型生成' | '导演工具箱';
    category?: ('画面设计' | '表演与调度' | '叙事与镜头' | '声音设计' | '连续性与约束' | '检查' | null);
    modality: 'text' | 'image' | 'video' | 'audio';
    inputs: Array<CanvasInputPortDefinition>;
    outputs: Array<CanvasOutputPortDefinition>;
    fields: Array<CanvasDesignFieldDefinition>;
    entries: Array<CanvasDesignFieldDefinition>;
};
