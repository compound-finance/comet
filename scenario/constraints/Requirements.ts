// TODO: Could define strict types for these objects
export interface Requirements {
    filter?: (context) => Promise<boolean>;
    tokenBalances?: object; // Token balance constraint
    cometBalances?: object; // Comet balance constraint
    upgrade?: boolean | object; // Modern constraint
    pause?: object; // Pause constraint
    utilization?: number; // Utilization constraint
}