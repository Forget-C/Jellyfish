/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 项目的生产方式（起点）。
 *
 * 两种起点最终汇入同一条生产流程，只是第一步不同：
 *
 * - ``script``  从剧本开始：导入/填写剧本 → 拆镜 → 资产准备 → 整集提示词 → 绑定 → 生成/导出；
 * - ``prompts`` 从视频提示词开始：创建后自动建默认章节，直接进「整集视频提示词」看板，
 * 导入并确认后按顺序创建/匹配镜头，再继续资产准备或直接进入绑定。
 */
export type ProjectStartMode = 'script' | 'prompts';
