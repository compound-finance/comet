// TODO: Could define strict types for these objects
export interface Requirements {
    filter?: (context) => Promise<boolean>; // Filter constraint
    upgrade?: boolean | object; // Modern constraint
    pause?: object; // Pause constraint
    supplyCaps?: object; // Supply cap constraint
    cometBalances?: object; // Comet balance constraint
    tokenBalances?: object; // Token balance constraint
    utilization?: number; // Utilization constraint
    prices?: object; // Price constraint
    reserves?: number | string; // Reserves constraint
}