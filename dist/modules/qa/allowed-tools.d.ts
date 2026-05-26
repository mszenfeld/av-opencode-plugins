declare const SHARED_TOOLS: string[];
declare const FE_TOOLS: string[];
declare const BE_TOOLS: string[];
type QaTesterStack = "fe" | "be";
declare function toolsForVariant(stack: QaTesterStack): string[];

export { BE_TOOLS, FE_TOOLS, type QaTesterStack, SHARED_TOOLS, toolsForVariant };
