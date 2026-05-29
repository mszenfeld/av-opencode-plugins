interface ConfigLike {
    mcp?: Record<string, unknown>;
}
declare function isSerenaAvailable(config: ConfigLike): boolean;

export { type ConfigLike, isSerenaAvailable };
