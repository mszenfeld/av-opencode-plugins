/**
 * Schema validation for pantheon.json files. Pure functions — no I/O, no globals.
 *
 * Returns `{ config, errors }` rather than throwing so a single bad agent does
 * not invalidate the whole file. The caller (loader.ts) accumulates `errors`
 * across all source files for diagnostic display.
 */
type PantheonConfig = {
    agents: {
        [name: string]: {
            model: string;
        };
    };
};
type ValidationResult = {
    config: PantheonConfig;
    errors: string[];
};
declare function validateConfigFile(raw: unknown, sourcePath?: string): ValidationResult;

export { type PantheonConfig, type ValidationResult, validateConfigFile };
