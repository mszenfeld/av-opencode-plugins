import { PantheonConfig } from './schema.js';
export { validateConfigFile } from './schema.js';
export { userGlobalPath, walkUpProjectPaths } from './paths.js';
export { loadFresh } from './loader.js';

declare function loadPantheonConfig(): PantheonConfig;
declare function getLoadErrors(): string[];
declare function pantheonConfigEmpty(): boolean;
/** Test-only: reset the cache between tests. Do not call in production code. */
declare function __resetCacheForTests(): void;

export { PantheonConfig, __resetCacheForTests, getLoadErrors, loadPantheonConfig, pantheonConfigEmpty };
