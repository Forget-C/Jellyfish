/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Freeze the identity and endpoints of a candidate connection.
 */
export type ConnectCardsTarget = {
    kind: 'connect_cards';
    source_card: string;
    source_port: string;
    target_card: string;
    target_port: string;
    connection_id: string;
};
