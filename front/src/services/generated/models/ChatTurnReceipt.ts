/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ChatTurnReceipt = {
    session_id: string;
    turn_id: string;
    /**
     * Subscribe after this cursor to replay the submitted turn.
     */
    cursor: number;
};
