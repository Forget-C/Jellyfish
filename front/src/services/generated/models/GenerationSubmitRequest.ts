/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetPromptAudit } from './AssetPromptAudit';
import type { AssetPromptReference } from './AssetPromptReference';
import type { ImageGenerationOperationInput } from './ImageGenerationOperationInput';
import type { ImageMediaInput } from './ImageMediaInput';
import type { ScriptOperationInput } from './ScriptOperationInput';
import type { TextChatInput } from './TextChatInput';
import type { VideoGenerationOperationInput } from './VideoGenerationOperationInput';
import type { VideoMediaInput_Input } from './VideoMediaInput_Input';
/**
 * 业务路由接收的请求；目标、模态、operation 与 delivery 由路径决定。
 */
export type GenerationSubmitRequest = {
    model_id?: (string | null);
    execution_prompt?: (string | null);
    media?: (ImageMediaInput | VideoMediaInput_Input | null);
    render_id?: (string | null);
    asset_prompt_audit?: (AssetPromptAudit | null);
    asset_references?: (Array<AssetPromptReference> | null);
    operation_input: (TextChatInput | ScriptOperationInput | ImageGenerationOperationInput | VideoGenerationOperationInput);
};
