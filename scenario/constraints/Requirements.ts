// XXX Define strict types for these objects
export interface Requirements {
    tokenBalances?: object, // Token balance constraint
    cometBalances?: object, // Comet balance constraint
    upgrade?: boolean | object, // Modern constraint
    pause?: object, // Pause constraint
    utilization?: number, // Utilization constraint
};