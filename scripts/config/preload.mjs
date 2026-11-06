// Node preload (`node --import ./scripts/config/preload.mjs …`) and first import of CLI scripts:
// loads the configuration before anything reads process.env. See load-config.mjs.
import { applyConfigOrExit } from './load-config.mjs';

applyConfigOrExit();
