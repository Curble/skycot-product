// Enables the compile cache before the main bundle loads, so the cache also
// covers main.cjs itself.
require("./compileCache.cjs");
// nondev-seam: brand-boot
require("../../../nondev/brand/env.cjs");
require("./main.cjs");
