import { BindingsStore, BindingSnapshot } from './bindings-store.js';
import './secret.js';

declare function scrubSecrets(text: string, parentID: string, store: BindingsStore, snapshot?: BindingSnapshot): string;

export { scrubSecrets };
