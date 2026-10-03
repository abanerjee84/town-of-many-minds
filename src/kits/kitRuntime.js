import { KitRegistry } from './kitRegistry.js';
import { registerBuiltinKits } from './builtinManifests.js';

/**
 * The immutable built-in registry shared by the action vocabulary and every
 * Town instance. Registry state is catalogue/route metadata only; hook calls
 * always receive the current town, so simulations remain isolated.
 */
export const BUILTIN_KIT_REGISTRY = registerBuiltinKits(new KitRegistry());
BUILTIN_KIT_REGISTRY.validate();
