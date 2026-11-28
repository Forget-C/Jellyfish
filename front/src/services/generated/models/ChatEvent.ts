/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatMessageEvent } from './ChatMessageEvent';
import type { ChatSceneEvent } from './ChatSceneEvent';
import type { ChatTaskEvent } from './ChatTaskEvent';
import type { ChatToolEvent } from './ChatToolEvent';
import type { ChatTurnEvent } from './ChatTurnEvent';
/**
 * One JSON event per SSE data frame; category determines the typed payload.
 */
export type ChatEvent = (ChatMessageEvent | ChatToolEvent | ChatTurnEvent | ChatTaskEvent | ChatSceneEvent);
