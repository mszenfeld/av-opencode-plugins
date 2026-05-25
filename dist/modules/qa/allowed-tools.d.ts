declare const SHARED_TOOLS: string[];
declare const FE_TOOLS: string[];
declare const BE_TOOLS: string[];
declare const SETUP_TOOLS: string[];
type QaTesterStack = "fe" | "be" | "setup";
declare function toolsForVariant(stack: QaTesterStack): string[];

export { BE_TOOLS, FE_TOOLS, type QaTesterStack, SETUP_TOOLS, SHARED_TOOLS, toolsForVariant };
