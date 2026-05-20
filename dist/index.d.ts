import { Plugin } from '@opencode-ai/plugin';

declare function createAppVerkPlugins(pluginFactories?: Plugin[]): Plugin;
declare const AppVerkPlugins: Plugin;

export { AppVerkPlugins, createAppVerkPlugins, AppVerkPlugins as default };
