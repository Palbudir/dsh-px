/*! Bundled semver (ISC)
The ISC License

Copyright (c) Isaac Z. Schlueter and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

*/
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/semver/internal/debug.js
var require_debug = __commonJS({
  "node_modules/semver/internal/debug.js"(exports, module) {
    "use strict";
    var debug = typeof process === "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...args) => console.error("SEMVER", ...args) : () => {
    };
    module.exports = debug;
  }
});

// node_modules/semver/internal/constants.js
var require_constants = __commonJS({
  "node_modules/semver/internal/constants.js"(exports, module) {
    "use strict";
    var SEMVER_SPEC_VERSION = "2.0.0";
    var MAX_LENGTH = 256;
    var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
    9007199254740991;
    var MAX_SAFE_COMPONENT_LENGTH = 16;
    var MAX_SAFE_BUILD_LENGTH = MAX_LENGTH - 6;
    var RELEASE_TYPES = [
      "major",
      "premajor",
      "minor",
      "preminor",
      "patch",
      "prepatch",
      "prerelease"
    ];
    module.exports = {
      MAX_LENGTH,
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_SAFE_INTEGER,
      RELEASE_TYPES,
      SEMVER_SPEC_VERSION,
      FLAG_INCLUDE_PRERELEASE: 1,
      FLAG_LOOSE: 2
    };
  }
});

// node_modules/semver/internal/re.js
var require_re = __commonJS({
  "node_modules/semver/internal/re.js"(exports, module) {
    "use strict";
    var {
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_LENGTH
    } = require_constants();
    var debug = require_debug();
    exports = module.exports = {};
    var re = exports.re = [];
    var safeRe = exports.safeRe = [];
    var src = exports.src = [];
    var safeSrc = exports.safeSrc = [];
    var t = exports.t = {};
    var R = 0;
    var LETTERDASHNUMBER = "[a-zA-Z0-9-]";
    var safeRegexReplacements = [
      ["\\s", 1],
      ["\\d", MAX_LENGTH],
      [LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH]
    ];
    var makeSafeRegex = (value) => {
      for (const [token, max] of safeRegexReplacements) {
        value = value.split(`${token}*`).join(`${token}{0,${max}}`).split(`${token}+`).join(`${token}{1,${max}}`);
      }
      return value;
    };
    var createToken = (name2, value, isGlobal) => {
      const safe = makeSafeRegex(value);
      const index = R++;
      debug(name2, index, value);
      t[name2] = index;
      src[index] = value;
      safeSrc[index] = safe;
      re[index] = new RegExp(value, isGlobal ? "g" : void 0);
      safeRe[index] = new RegExp(safe, isGlobal ? "g" : void 0);
    };
    createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
    createToken("NUMERICIDENTIFIERLOOSE", "\\d+");
    createToken("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`);
    createToken("MAINVERSION", `(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})`);
    createToken("MAINVERSIONLOOSE", `(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASEIDENTIFIER", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIER]})`);
    createToken("PRERELEASEIDENTIFIERLOOSE", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASE", `(?:-(${src[t.PRERELEASEIDENTIFIER]}(?:\\.${src[t.PRERELEASEIDENTIFIER]})*))`);
    createToken("PRERELEASELOOSE", `(?:-?(${src[t.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${src[t.PRERELEASEIDENTIFIERLOOSE]})*))`);
    createToken("BUILDIDENTIFIER", `${LETTERDASHNUMBER}+`);
    createToken("BUILD", `(?:\\+(${src[t.BUILDIDENTIFIER]}(?:\\.${src[t.BUILDIDENTIFIER]})*))`);
    createToken("FULLPLAIN", `v?${src[t.MAINVERSION]}${src[t.PRERELEASE]}?${src[t.BUILD]}?`);
    createToken("FULL", `^${src[t.FULLPLAIN]}$`);
    createToken("LOOSEPLAIN", `[v=\\s]*${src[t.MAINVERSIONLOOSE]}${src[t.PRERELEASELOOSE]}?${src[t.BUILD]}?`);
    createToken("LOOSE", `^${src[t.LOOSEPLAIN]}$`);
    createToken("GTLT", "((?:<|>)?=?)");
    createToken("XRANGEIDENTIFIERLOOSE", `${src[t.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`);
    createToken("XRANGEIDENTIFIER", `${src[t.NUMERICIDENTIFIER]}|x|X|\\*`);
    createToken("XRANGEPLAIN", `[v=\\s]*(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:${src[t.PRERELEASE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGEPLAINLOOSE", `[v=\\s]*(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:${src[t.PRERELEASELOOSE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAIN]}$`);
    createToken("XRANGELOOSE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COERCEPLAIN", `${"(^|[^\\d])(\\d{1,"}${MAX_SAFE_COMPONENT_LENGTH}})(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?`);
    createToken("COERCE", `${src[t.COERCEPLAIN]}(?:$|[^\\d])`);
    createToken("COERCEFULL", src[t.COERCEPLAIN] + `(?:${src[t.PRERELEASE]})?(?:${src[t.BUILD]})?(?:$|[^\\d])`);
    createToken("COERCERTL", src[t.COERCE], true);
    createToken("COERCERTLFULL", src[t.COERCEFULL], true);
    createToken("LONETILDE", "(?:~>?)");
    createToken("TILDETRIM", `(\\s*)${src[t.LONETILDE]}\\s+`, true);
    exports.tildeTrimReplace = "$1~";
    createToken("TILDE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAIN]}$`);
    createToken("TILDELOOSE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("LONECARET", "(?:\\^)");
    createToken("CARETTRIM", `(\\s*)${src[t.LONECARET]}\\s+`, true);
    exports.caretTrimReplace = "$1^";
    createToken("CARET", `^${src[t.LONECARET]}${src[t.XRANGEPLAIN]}$`);
    createToken("CARETLOOSE", `^${src[t.LONECARET]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COMPARATORLOOSE", `^${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]})$|^$`);
    createToken("COMPARATOR", `^${src[t.GTLT]}\\s*(${src[t.FULLPLAIN]})$|^$`);
    createToken("COMPARATORTRIM", `(\\s*)${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]}|${src[t.XRANGEPLAIN]})`, true);
    exports.comparatorTrimReplace = "$1$2$3";
    createToken("HYPHENRANGE", `^\\s*(${src[t.XRANGEPLAIN]})\\s+-\\s+(${src[t.XRANGEPLAIN]})\\s*$`);
    createToken("HYPHENRANGELOOSE", `^\\s*(${src[t.XRANGEPLAINLOOSE]})\\s+-\\s+(${src[t.XRANGEPLAINLOOSE]})\\s*$`);
    createToken("STAR", "(<|>)?=?\\s*\\*");
    createToken("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$");
    createToken("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
  }
});

// node_modules/semver/internal/parse-options.js
var require_parse_options = __commonJS({
  "node_modules/semver/internal/parse-options.js"(exports, module) {
    "use strict";
    var looseOption = Object.freeze({ loose: true });
    var emptyOpts = Object.freeze({});
    var parseOptions = (options) => {
      if (!options) {
        return emptyOpts;
      }
      if (typeof options !== "object") {
        return looseOption;
      }
      return options;
    };
    module.exports = parseOptions;
  }
});

// node_modules/semver/internal/identifiers.js
var require_identifiers = __commonJS({
  "node_modules/semver/internal/identifiers.js"(exports, module) {
    "use strict";
    var numeric = /^[0-9]+$/;
    var compareIdentifiers = (a, b) => {
      if (typeof a === "number" && typeof b === "number") {
        return a === b ? 0 : a < b ? -1 : 1;
      }
      const anum = numeric.test(a);
      const bnum = numeric.test(b);
      if (anum && bnum) {
        a = +a;
        b = +b;
      }
      return a === b ? 0 : anum && !bnum ? -1 : bnum && !anum ? 1 : a < b ? -1 : 1;
    };
    var rcompareIdentifiers = (a, b) => compareIdentifiers(b, a);
    module.exports = {
      compareIdentifiers,
      rcompareIdentifiers
    };
  }
});

// node_modules/semver/classes/semver.js
var require_semver = __commonJS({
  "node_modules/semver/classes/semver.js"(exports, module) {
    "use strict";
    var debug = require_debug();
    var { MAX_LENGTH, MAX_SAFE_INTEGER } = require_constants();
    var { safeRe: re, t } = require_re();
    var parseOptions = require_parse_options();
    var { compareIdentifiers } = require_identifiers();
    var isPrereleaseIdentifier = (prerelease, identifier) => {
      const identifiers = identifier.split(".");
      if (identifiers.length > prerelease.length) {
        return false;
      }
      for (let i = 0; i < identifiers.length; i++) {
        if (compareIdentifiers(prerelease[i], identifiers[i]) !== 0) {
          return false;
        }
      }
      return true;
    };
    var SemVer = class _SemVer {
      constructor(version, options) {
        options = parseOptions(options);
        if (version instanceof _SemVer) {
          if (version.loose === !!options.loose && version.includePrerelease === !!options.includePrerelease) {
            return version;
          } else {
            version = version.version;
          }
        } else if (typeof version !== "string") {
          throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`);
        }
        if (version.length > MAX_LENGTH) {
          throw new TypeError(
            `version is longer than ${MAX_LENGTH} characters`
          );
        }
        debug("SemVer", version, options);
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        const m = version.trim().match(options.loose ? re[t.LOOSE] : re[t.FULL]);
        if (!m) {
          throw new TypeError(`Invalid Version: ${version}`);
        }
        this.raw = version;
        this.major = +m[1];
        this.minor = +m[2];
        this.patch = +m[3];
        if (this.major > MAX_SAFE_INTEGER || this.major < 0) {
          throw new TypeError("Invalid major version");
        }
        if (this.minor > MAX_SAFE_INTEGER || this.minor < 0) {
          throw new TypeError("Invalid minor version");
        }
        if (this.patch > MAX_SAFE_INTEGER || this.patch < 0) {
          throw new TypeError("Invalid patch version");
        }
        if (!m[4]) {
          this.prerelease = [];
        } else {
          this.prerelease = m[4].split(".").map((id) => {
            if (/^[0-9]+$/.test(id)) {
              const num = +id;
              if (num >= 0 && num < MAX_SAFE_INTEGER) {
                return num;
              }
            }
            return id;
          });
        }
        this.build = m[5] ? m[5].split(".") : [];
        this.format();
      }
      format() {
        this.version = `${this.major}.${this.minor}.${this.patch}`;
        if (this.prerelease.length) {
          this.version += `-${this.prerelease.join(".")}`;
        }
        return this.version;
      }
      toString() {
        return this.version;
      }
      compare(other) {
        debug("SemVer.compare", this.version, this.options, other);
        if (!(other instanceof _SemVer)) {
          if (typeof other === "string" && other === this.version) {
            return 0;
          }
          other = new _SemVer(other, this.options);
        }
        if (other.version === this.version) {
          return 0;
        }
        return this.compareMain(other) || this.comparePre(other);
      }
      compareMain(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.major < other.major) {
          return -1;
        }
        if (this.major > other.major) {
          return 1;
        }
        if (this.minor < other.minor) {
          return -1;
        }
        if (this.minor > other.minor) {
          return 1;
        }
        if (this.patch < other.patch) {
          return -1;
        }
        if (this.patch > other.patch) {
          return 1;
        }
        return 0;
      }
      comparePre(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.prerelease.length && !other.prerelease.length) {
          return -1;
        } else if (!this.prerelease.length && other.prerelease.length) {
          return 1;
        } else if (!this.prerelease.length && !other.prerelease.length) {
          return 0;
        }
        let i = 0;
        do {
          const a = this.prerelease[i];
          const b = other.prerelease[i];
          debug("prerelease compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      compareBuild(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        let i = 0;
        do {
          const a = this.build[i];
          const b = other.build[i];
          debug("build compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      // preminor will bump the version up to the next minor release, and immediately
      // down to pre-release. premajor and prepatch work the same way.
      inc(release, identifier, identifierBase) {
        if (release.startsWith("pre")) {
          if (!identifier && identifierBase === false) {
            throw new Error("invalid increment argument: identifier is empty");
          }
          if (identifier) {
            const match = `-${identifier}`.match(this.options.loose ? re[t.PRERELEASELOOSE] : re[t.PRERELEASE]);
            if (!match || match[1] !== identifier) {
              throw new Error(`invalid identifier: ${identifier}`);
            }
          }
        }
        switch (release) {
          case "premajor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor = 0;
            this.major++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "preminor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "prepatch":
            this.prerelease.length = 0;
            this.inc("patch", identifier, identifierBase);
            this.inc("pre", identifier, identifierBase);
            break;
          // If the input is a non-prerelease version, this acts the same as
          // prepatch.
          case "prerelease":
            if (this.prerelease.length === 0) {
              this.inc("patch", identifier, identifierBase);
            }
            this.inc("pre", identifier, identifierBase);
            break;
          case "release":
            if (this.prerelease.length === 0) {
              throw new Error(`version ${this.raw} is not a prerelease`);
            }
            this.prerelease.length = 0;
            break;
          case "major":
            if (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) {
              this.major++;
            }
            this.minor = 0;
            this.patch = 0;
            this.prerelease = [];
            break;
          case "minor":
            if (this.patch !== 0 || this.prerelease.length === 0) {
              this.minor++;
            }
            this.patch = 0;
            this.prerelease = [];
            break;
          case "patch":
            if (this.prerelease.length === 0) {
              this.patch++;
            }
            this.prerelease = [];
            break;
          // This probably shouldn't be used publicly.
          // 1.0.0 'pre' would become 1.0.0-0 which is the wrong direction.
          case "pre": {
            const base = Number(identifierBase) ? 1 : 0;
            if (this.prerelease.length === 0) {
              this.prerelease = [base];
            } else {
              let i = this.prerelease.length;
              while (--i >= 0) {
                if (typeof this.prerelease[i] === "number") {
                  this.prerelease[i]++;
                  i = -2;
                }
              }
              if (i === -1) {
                if (identifier === this.prerelease.join(".") && identifierBase === false) {
                  throw new Error("invalid increment argument: identifier already exists");
                }
                this.prerelease.push(base);
              }
            }
            if (identifier) {
              let prerelease = [identifier, base];
              if (identifierBase === false) {
                prerelease = [identifier];
              }
              if (isPrereleaseIdentifier(this.prerelease, identifier)) {
                const prereleaseBase = this.prerelease[identifier.split(".").length];
                if (isNaN(prereleaseBase)) {
                  this.prerelease = prerelease;
                }
              } else {
                this.prerelease = prerelease;
              }
            }
            break;
          }
          default:
            throw new Error(`invalid increment argument: ${release}`);
        }
        this.raw = this.format();
        if (this.build.length) {
          this.raw += `+${this.build.join(".")}`;
        }
        return this;
      }
    };
    module.exports = SemVer;
  }
});

// node_modules/semver/functions/parse.js
var require_parse = __commonJS({
  "node_modules/semver/functions/parse.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var parse = (version, options, throwErrors = false) => {
      if (version instanceof SemVer) {
        return version;
      }
      try {
        return new SemVer(version, options);
      } catch (er) {
        if (!throwErrors) {
          return null;
        }
        throw er;
      }
    };
    module.exports = parse;
  }
});

// node_modules/semver/functions/valid.js
var require_valid = __commonJS({
  "node_modules/semver/functions/valid.js"(exports, module) {
    "use strict";
    var parse = require_parse();
    var valid2 = (version, options) => {
      const v = parse(version, options);
      return v ? v.version : null;
    };
    module.exports = valid2;
  }
});

// node_modules/semver/functions/compare.js
var require_compare = __commonJS({
  "node_modules/semver/functions/compare.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var compare = (a, b, loose) => new SemVer(a, loose).compare(new SemVer(b, loose));
    module.exports = compare;
  }
});

// node_modules/semver/functions/gt.js
var require_gt = __commonJS({
  "node_modules/semver/functions/gt.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var gt2 = (a, b, loose) => compare(a, b, loose) > 0;
    module.exports = gt2;
  }
});

// packages/dsh-px-updater/src/index.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// packages/dsh-px-updater/src/version.ts
var import_valid = __toESM(require_valid(), 1);
var import_gt = __toESM(require_gt(), 1);
function isValidVersion(value) {
  return typeof value === "string" && (0, import_valid.default)(value.trim()) !== null;
}
function isNewer(candidate, current) {
  if (typeof candidate !== "string" || typeof current !== "string") return false;
  const a = (0, import_valid.default)(candidate.trim());
  const b = (0, import_valid.default)(current.trim());
  return a !== null && b !== null && (0, import_gt.default)(a, b);
}

// packages/dsh-px-updater/src/index.ts
var name = "dsh-px-updater";
var inject = [];
var DEFAULTS = {
  repository: "Palbudir/dsh-px",
  timeoutMs: 8e3,
  registerTool: true,
  routePrefix: "/dsh-px-updater"
};
function resourcesPath() {
  const v = process.resourcesPath;
  return typeof v === "string" && v.length > 0 ? v : null;
}
function readAppInfo() {
  const empty = { appVersion: null, dshVersion: null, platform: null, manifestPath: null };
  const candidates = [];
  if (process.env.DSH_PX_RUNTIME_ROOT) candidates.push(process.env.DSH_PX_RUNTIME_ROOT);
  const res = resourcesPath();
  if (res !== null) candidates.push(join(res, "runtime"));
  let here = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    candidates.push(here);
    const parent = dirname(here);
    if (parent === here) break;
    here = parent;
  }
  for (const root of candidates) {
    const manifestPath = join(root, "runtime-manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf8"));
      return {
        // 应用版本来自装配时写入的 manifest —— 这是唯一可靠的来源。
        // 不用 `app.getVersion()`（那是外壳的事，且开发态会返回 Electron 版本）。
        appVersion: m.app?.version ?? null,
        dshVersion: m.dsh?.version ?? null,
        platform: m.platform ?? null,
        manifestPath
      };
    } catch {
    }
  }
  return empty;
}
function shellUserData() {
  const fromEnv = process.env.DSH_PX_USER_DATA;
  return typeof fromEnv === "string" && fromEnv.length > 0 ? fromEnv : null;
}
function readShellState() {
  const dir = shellUserData();
  if (dir === null) return null;
  try {
    const raw = readFileSync(join(dir, "update-bridge", "state.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return { ...parsed, available: true };
  } catch {
    return null;
  }
}
function requestShellAction(action) {
  const dir = shellUserData();
  if (dir === null) return false;
  try {
    const bridgeDir = join(dir, "update-bridge");
    mkdirSync(bridgeDir, { recursive: true });
    writeFileSync(join(bridgeDir, `${action}.req`), `${(/* @__PURE__ */ new Date()).toISOString()}
`);
    return true;
  } catch {
    return false;
  }
}
async function fetchJson(url, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { accept: "application/json", "user-agent": "dsh-px-updater" }
    });
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
async function checkUpdates(config) {
  const info = readAppInfo();
  const result = {
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    current: {
      app: info.appVersion ?? "\u672A\u77E5",
      dsh: info.dshVersion ?? "\u672A\u77E5",
      platform: info.platform ?? process.platform
    },
    latest: { app: null, dsh: null },
    updateAvailable: { app: false, dsh: false },
    releaseUrl: null,
    releaseNotes: null,
    errors: []
  };
  try {
    const rel = await fetchJson(`https://api.github.com/repos/${config.repository}/releases/latest`, config.timeoutMs);
    if (!isValidVersion(rel.tag_name)) throw new Error("\u53D1\u5E03\u9875\u672A\u8FD4\u56DE\u6709\u6548\u7248\u672C\u53F7");
    result.latest.app = typeof rel.tag_name === "string" ? rel.tag_name : null;
    result.releaseUrl = typeof rel.html_url === "string" ? rel.html_url : null;
    result.releaseNotes = typeof rel.body === "string" ? rel.body : null;
    result.updateAvailable.app = isNewer(rel.tag_name ?? null, info.appVersion);
  } catch (err) {
    result.errors.push(`\u67E5\u8BE2 GitHub Releases \u5931\u8D25\uFF1A${errText(err)}`);
  }
  try {
    const pkg = await fetchJson("https://registry.npmjs.org/@deepseek-ai%2Fdsh", config.timeoutMs);
    const distTags = pkg["dist-tags"];
    const latest = distTags?.latest ?? null;
    if (!isValidVersion(latest)) throw new Error("npm \u672A\u8FD4\u56DE\u6709\u6548\u7248\u672C\u53F7");
    result.latest.dsh = latest;
    result.updateAvailable.dsh = isNewer(latest, info.dshVersion);
  } catch (err) {
    result.errors.push(`\u67E5\u8BE2 npm \u4E0A\u7684 dsh \u7248\u672C\u5931\u8D25\uFF1A${errText(err)}`);
  }
  return result;
}
function errText(err) {
  return err instanceof Error ? err.message : String(err);
}
function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...rawConfig ?? {} };
  const info = readAppInfo();
  const say = (msg) => {
    try {
      const sink = ctx.logger?.info ?? ctx.logger?.debug ?? console.log;
      sink.call(ctx.logger ?? console, `[dsh-px-updater] ${msg}`);
    } catch {
    }
  };
  say(`\u5DF2\u52A0\u8F7D\uFF08dsh ${info.dshVersion ?? "\u672A\u77E5"}\uFF0C${info.platform ?? process.platform}\uFF09`);
  ctx.inject(["webServer"], (hostCtx) => {
    const webServer = hostCtx.webServer;
    if (webServer?.register === void 0) {
      say("webServer \u5DF2\u6CE8\u5165\u4F46\u6CA1\u6709 register \u65B9\u6CD5\uFF0C\u8DF3\u8FC7 HTTP \u7AEF\u70B9");
      return;
    }
    const sendJson = (res, code, body) => {
      res.writeHead(code, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify(body, null, 2));
    };
    const disposeStatus = webServer.register({
      kind: "exact",
      path: `${config.routePrefix}/status`,
      handler: (_req, res) => {
        sendJson(res, 200, {
          plugin: name,
          version: "0.1.0",
          current: { app: info.appVersion, dsh: info.dshVersion, platform: info.platform },
          manifestPath: info.manifestPath,
          repository: config.repository
        });
      }
    });
    const disposeCheck = webServer.register({
      kind: "exact",
      path: `${config.routePrefix}/check`,
      handler: async (_req, res) => {
        const outcome = await checkUpdates(config);
        const bothFailed = outcome.errors.length >= 2;
        sendJson(res, bothFailed ? 502 : 200, outcome);
      }
    });
    const disposeShellCheck = webServer.register({
      kind: "exact",
      path: `${config.routePrefix}/check-shell`,
      handler: (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "\u53EA\u63A5\u53D7 POST" });
          return;
        }
        const ok = requestShellAction("check");
        sendJson(res, ok ? 202 : 503, ok ? { ok: true, message: "\u5DF2\u8BF7\u6C42\u684C\u9762\u5BA2\u6237\u7AEF\u68C0\u67E5\u66F4\u65B0" } : { ok: false, error: "\u684C\u9762\u5BA2\u6237\u7AEF\u672A\u8FDE\u63A5\uFF0C\u53EA\u80FD\u67E5\u8BE2\u7248\u672C\u4FE1\u606F" });
      }
    });
    const disposeShellState = webServer.register({
      kind: "exact",
      path: `${config.routePrefix}/shell-state`,
      handler: (_req, res) => {
        const bridge = readShellState();
        sendJson(res, 200, bridge ?? {
          phase: "idle",
          status: "\u5916\u58F3\u672A\u63D0\u4F9B\u66F4\u65B0\u72B6\u6001\uFF08\u5F00\u53D1\u6001\u6B63\u5E38\uFF09",
          version: null,
          percent: null,
          error: null,
          available: false
        });
      }
    });
    const disposeInstall = webServer.register({
      kind: "exact",
      path: `${config.routePrefix}/install`,
      handler: (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "\u53EA\u63A5\u53D7 POST" });
          return;
        }
        const state = readShellState();
        if (state?.phase !== "ready") {
          sendJson(res, 409, { ok: false, error: "\u66F4\u65B0\u5C1A\u672A\u4E0B\u8F7D\u5B8C\u6210\uFF0C\u6216\u5B89\u88C5\u5DF2\u5728\u8FDB\u884C\u4E2D" });
          return;
        }
        const ok = requestShellAction("install");
        sendJson(res, ok ? 202 : 503, ok ? { ok: true, message: "\u5DF2\u8BF7\u6C42\u5916\u58F3\u91CD\u542F\u5E76\u5B89\u88C5" } : { ok: false, error: "\u627E\u4E0D\u5230\u5916\u58F3\u6570\u636E\u76EE\u5F55\uFF0C\u65E0\u6CD5\u8BF7\u6C42\u5B89\u88C5" });
      }
    });
    const disposeOpen = webServer.register({
      kind: "exact",
      path: `${config.routePrefix}/open`,
      handler: (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "\u53EA\u63A5\u53D7 POST" });
          return;
        }
        const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
        const raw = params.getAll("what").length === 1 ? params.get("what") : null;
        if (raw !== "open-data" && raw !== "open-log") {
          sendJson(res, 400, { ok: false, error: "what \u5FC5\u987B\u662F open-data \u6216 open-log" });
          return;
        }
        const ok = requestShellAction(raw);
        sendJson(res, ok ? 202 : 503, ok ? { ok: true, message: `\u5DF2\u8BF7\u6C42\u5916\u58F3\u6253\u5F00${raw === "open-data" ? "\u6570\u636E\u76EE\u5F55" : "\u65E5\u5FD7"}` } : { ok: false, error: "\u627E\u4E0D\u5230\u5916\u58F3\u6570\u636E\u76EE\u5F55" });
      }
    });
    say(`\u5DF2\u6CE8\u518C HTTP \u7AEF\u70B9 ${config.routePrefix}/{status,check,check-shell,shell-state,install,open}`);
    hostCtx.effect?.(() => () => {
      disposeStatus();
      disposeCheck();
      disposeShellCheck();
      disposeShellState();
      disposeInstall();
      disposeOpen();
    }, "dsh-px-updater: http routes");
  });
  if (config.registerTool) {
    ctx.inject(["tools"], (toolCtx) => {
      toolCtx.tools?.register({
        name: "dsh_px_version",
        description: "\u67E5\u8BE2\u5F53\u524D DSH-PX \u684C\u9762\u5BA2\u6237\u7AEF\u7684\u7248\u672C\u4FE1\u606F\uFF0C\u5E76\u68C0\u67E5\u662F\u5426\u6709\u65B0\u7248\u672C\u53EF\u7528\uFF08\u540C\u65F6\u68C0\u67E5\u5916\u58F3\u4E0E\u968F\u9644\u7684 dsh \u6838\u5FC3\uFF09\u3002",
        // parameters 必须是**标准 JSON Schema**（ToolSchema.parameters 的类型是
        // Record<string, unknown>，由 assertObjectJsonSchema 校验）。
        //
        // 这里曾写错：用了 `{ checkRemote: { type: 'boolean', required: false } }`
        // 这种"属性表"简写 —— 那是 defineTool 的**输入**格式，不是 ToolSchema。
        // JSON Schema 里 `required` 是**根级字符串数组**，不是属性上的布尔值；
        // 传错会让宿主报
        //   Invalid schema for function 'dsh_px_version': schema must be a JSON Schema
        //   of 'type: "object"', got 'type: "null"'
        // 并导致**整轮对话失败**（不只是本工具不可用），代价很大，故把原因写明。
        //
        // 本插件刻意不 import defineTool：见文件顶部说明 —— 自研插件保持零运行时
        // 依赖，避免 pnpm file:/link: 不装 peer 依赖导致的 ERR_MODULE_NOT_FOUND。
        parameters: {
          type: "object",
          properties: {
            checkRemote: {
              type: "boolean",
              description: "\u662F\u5426\u8054\u7F51\u67E5\u8BE2\u6700\u65B0\u7248\u672C\u3002\u4F20 false \u65F6\u53EA\u8FD4\u56DE\u672C\u5730\u7248\u672C\u4FE1\u606F\u3002"
            }
          },
          additionalProperties: false
        },
        output: {
          schema: { type: "string" },
          render: (_args, value) => [{ type: "text", text: value }]
        },
        async execute(args) {
          if (args?.checkRemote === false) {
            return `\u672C\u5730\u7248\u672C\uFF1Adsh ${info.dshVersion ?? "\u672A\u77E5"}\uFF08${info.platform ?? process.platform}\uFF09`;
          }
          const r = await checkUpdates(config);
          const lines = [
            `\u5F53\u524D\uFF1Adsh \u6838\u5FC3 ${r.current.dsh}`,
            `\u6700\u65B0\uFF1A\u5916\u58F3 ${r.latest.app ?? "\u672A\u77E5"}\uFF0Cdsh ${r.latest.dsh ?? "\u672A\u77E5"}`,
            `\u53EF\u66F4\u65B0\uFF1A\u5916\u58F3 ${r.updateAvailable.app ? "\u662F" : "\u5426"}\uFF0Cdsh \u6838\u5FC3 ${r.updateAvailable.dsh ? "\u662F" : "\u5426"}`
          ];
          if (r.releaseUrl !== null) lines.push(`\u53D1\u5E03\u9875\uFF1A${r.releaseUrl}`);
          if (r.errors.length > 0) lines.push(`\u6CE8\u610F\uFF1A${r.errors.join("\uFF1B")}`);
          return lines.join("\n");
        }
      });
    });
  }
}
export {
  DEFAULTS,
  apply,
  inject,
  name
};
