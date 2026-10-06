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

// packages/shared/request-trust.ts
function rejectUnauthenticatedRequest(req, res, connection) {
  const rejection = connection?.requestRejection({ headers: req.headers ?? {} });
  if (!connection || rejection !== void 0) {
    res.writeHead(connection ? rejection : 503, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(
      JSON.stringify({
        code: connection ? "HOST_AUTH_REQUIRED" : "HOST_AUTH_UNAVAILABLE",
        error: "\u8BF7\u901A\u8FC7\u5BBF\u4E3B\u63D0\u4F9B\u7684\u767B\u5F55\u5165\u53E3\u8FDE\u63A5\u6B64\u670D\u52A1\u3002"
      })
    );
    return true;
  }
  return rejectUntrustedRequest(req, res);
}
function trustedLocalRequest(req) {
  const headers = req.headers ?? {}, host = headers.host, origin = headers.origin;
  if (typeof host !== "string" || headers["sec-fetch-site"] === "cross-site") return false;
  try {
    const target = new URL("http://" + host);
    if (target.username || target.password || target.pathname !== "/" || target.search || target.hash)
      return false;
    const parts = target.hostname.split(".");
    const loopback = target.hostname === "localhost" || target.hostname === "[::1]" || parts.length === 4 && parts[0] === "127" && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
    if (!loopback) return false;
    if (origin === void 0) return true;
    if (typeof origin !== "string") return false;
    const source = new URL(origin);
    return ["http:", "https:"].includes(source.protocol) && source.hostname === target.hostname && (!source.port || source.port === target.port);
  } catch {
    return false;
  }
}
function rejectUntrustedRequest(req, res) {
  if (trustedLocalRequest(req)) return false;
  res.writeHead(403, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(
    JSON.stringify({
      code: "UNTRUSTED_REQUEST",
      error: "\u6B64\u8BF7\u6C42\u7684\u6765\u6E90\u4E0D\u53D7\u4FE1\u4EFB\uFF0C\u8BF7\u4ECE\u672C\u673A DSH-PX \u754C\u9762\u91CD\u8BD5\u3002",
      retryable: false
    })
  );
  return true;
}

// packages/dsh-px-updater/src/metadata.ts
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
var LIMIT = 2 * 1024 * 1024;
function decodeBody(bytes, encoding) {
  if (bytes.byteLength > LIMIT) throw new Error("\u7248\u672C\u4FE1\u606F\u8D85\u8FC7\u8BFB\u53D6\u4E0A\u9650");
  let body = Buffer.from(bytes);
  const plain = () => /^[\s\uFEFF]*[\[{]/u.test(body.toString("utf8", 0, Math.min(256, body.length)));
  if (!plain()) {
    try {
      for (const item of (encoding ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).reverse()) {
        if (item === "gzip" || item === "x-gzip") body = gunzipSync(body, { maxOutputLength: LIMIT });
        else if (item === "br") body = brotliDecompressSync(body, { maxOutputLength: LIMIT });
        else if (item === "deflate") body = inflateSync(body, { maxOutputLength: LIMIT });
        else if (item !== "identity") throw new Error("unsupported encoding");
      }
    } catch {
      throw new Error("\u7248\u672C\u670D\u52A1\u8FD4\u56DE\u7684\u538B\u7F29\u6570\u636E\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    }
  }
  return body;
}
async function fetchMetadataText(url, timeoutMs) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "accept-encoding": "identity", "user-agent": "dsh-px-updater" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("\u7248\u672C\u670D\u52A1\u8FD4\u56DE\u4E86\u7A7A\u54CD\u5E94");
    const chunks = [];
    let length = 0;
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > LIMIT) {
          await reader.cancel();
          throw new Error("\u7248\u672C\u4FE1\u606F\u8D85\u8FC7\u8BFB\u53D6\u4E0A\u9650");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return decodeBody(Buffer.concat(chunks), response.headers.get("content-encoding")).toString("utf8").replace(/^\uFEFF/u, "");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("\u7248\u672C\u67E5\u8BE2\u8D85\u65F6\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// config/update-keys.json
var update_keys_default = {
  schemaVersion: 1,
  keys: {
    d03d2113641ecf60a2863ec0: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAP4TqRQC4G9AQfAC1XcRfVyoEvUTtBTnEzYXLSR5jfIU=\n-----END PUBLIC KEY-----\n"
  }
};

// config/products.json
var products_default = {
  schemaVersion: 1,
  protocolGeneration: 4,
  pack: {
    version: "0.4.2-alpha.1",
    dataSchemaVersion: 1,
    hostVersions: ["0.2.0-rc.2"],
    surfaces: ["web", "px-desktop"]
  },
  desktop: {
    version: "0.4.2-alpha.1",
    packVersion: "0.4.2-alpha.1",
    hostVersion: "0.2.0-rc.2",
    architecture: "official-derived"
  }
};

// src/shared/signed-release.ts
import { createPublicKey, sign, verify } from "node:crypto";

// src/shared/product-contract.ts
function versionGeneration(version) {
  if (typeof version !== "string") throw new Error("Product version must be a string");
  const match = /^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/.exec(
    version
  );
  if (!match || !Number.isSafeInteger(Number(match[1])))
    throw new Error("Product version must use canonical 0.x.y with an optional prerelease");
  return Number(match[1]);
}

// src/shared/signed-release.ts
function canonicalRelease(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalRelease).join(",") + "]";
  if (value && typeof value === "object")
    return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ":" + canonicalRelease(item)).join(",") + "}";
  return JSON.stringify(value);
}
function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some((key) => !Object.hasOwn(value, key)))
    throw new Error("\u66F4\u65B0\u6E05\u5355\u5B57\u6BB5\u4E0D\u5B8C\u6574\u6216\u5305\u542B\u672A\u77E5\u5B57\u6BB5");
}
function base64(value, bytes) {
  return typeof value === "string" && Buffer.from(value, "base64").length === bytes && Buffer.from(value, "base64").toString("base64") === value;
}
function validateReleaseManifest(value) {
  exact(value, [
    "schemaVersion",
    "product",
    "channel",
    "platform",
    "version",
    "packVersion",
    "protocolGeneration",
    "upgradeFromGenerations",
    "hostVersion",
    "upstreamCommit",
    "sourceCommit",
    "issuedAt",
    "files"
  ]);
  if (value.schemaVersion !== 1 || !["pack", "desktop"].includes(value.product) || !["stable", "preview"].includes(value.channel) || value.platform !== (value.product === "pack" ? "any" : "win32-x64"))
    throw new Error("\u66F4\u65B0\u4EA7\u54C1\u6216\u5E73\u53F0\u65E0\u6548");
  if (!Number.isSafeInteger(value.protocolGeneration) || value.protocolGeneration < 1 || versionGeneration(value.version) !== value.protocolGeneration || versionGeneration(value.packVersion) !== value.protocolGeneration)
    throw new Error("\u66F4\u65B0\u7248\u672C\u4E0E\u534F\u8BAE\u4EE3\u9645\u4E0D\u4E00\u81F4");
  if (value.product === "pack" && value.packVersion !== value.version) throw new Error("Pack \u7248\u672C\u4E0D\u4E00\u81F4");
  if (!Array.isArray(value.upgradeFromGenerations) || value.upgradeFromGenerations.length > 16 || value.upgradeFromGenerations.some(
    (generation) => !Number.isSafeInteger(generation) || Number(generation) < 1 || Number(generation) > value.protocolGeneration
  ) || new Set(value.upgradeFromGenerations).size !== value.upgradeFromGenerations.length || (value.product === "pack" ? value.upgradeFromGenerations.length !== 0 : !value.upgradeFromGenerations.includes(value.protocolGeneration)))
    throw new Error("\u66F4\u65B0\u4EE3\u9645\u8FC1\u79FB\u8BB8\u53EF\u65E0\u6548");
  if (value.channel === "stable" && value.version.includes("-")) throw new Error("\u7A33\u5B9A\u901A\u9053\u4E0D\u80FD\u53D1\u5E03\u9884\u89C8\u7248\u672C");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.hostVersion) || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || !/^[a-f0-9]{40}$/.test(value.upstreamCommit) || typeof value.issuedAt !== "string" || !Number.isFinite(Date.parse(value.issuedAt)) || new Date(value.issuedAt).toISOString() !== value.issuedAt)
    throw new Error("\u66F4\u65B0\u6765\u6E90\u6216\u65F6\u95F4\u65E0\u6548");
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 2)
    throw new Error("\u66F4\u65B0\u6587\u4EF6\u6E05\u5355\u65E0\u6548");
  const names = /* @__PURE__ */ new Set(), roles = /* @__PURE__ */ new Set();
  for (const file of value.files) {
    exact(file, ["role", "name", "url", "size", "sha256", "sha512"]);
    if (!["installer", "blockmap", "pack"].includes(file.role) || typeof file.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/.test(file.name) || file.name.includes("..") || names.has(file.name) || roles.has(file.role) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 8 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(file.sha256) || !base64(file.sha512, 64))
      throw new Error("\u66F4\u65B0\u6587\u4EF6\u8EAB\u4EFD\u6216\u6458\u8981\u65E0\u6548");
    const expected = `https://github.com/Palbudir/dsh-px/releases/download/${value.product}-v${value.version}/${file.name}`;
    if (file.url !== expected) throw new Error("\u66F4\u65B0\u6587\u4EF6\u5FC5\u987B\u6765\u81EA\u8BE5\u4EA7\u54C1\u7684\u56FA\u5B9A\u53D1\u884C\u5730\u5740");
    if (file.role === "installer" && !file.name.endsWith(".exe") || file.role === "pack" && !file.name.endsWith(".tgz") || file.role === "blockmap" && !file.name.endsWith(".exe.blockmap"))
      throw new Error("\u66F4\u65B0\u6587\u4EF6\u7C7B\u578B\u4E0D\u4E00\u81F4");
    names.add(file.name);
    roles.add(file.role);
  }
  if (value.product === "pack" ? roles.size !== 1 || !roles.has("pack") : !roles.has("installer") || roles.has("pack"))
    throw new Error("\u66F4\u65B0\u6587\u4EF6\u4E0E\u4EA7\u54C1\u4E0D\u5339\u914D");
  const blockmap = value.files.find((file) => file.role === "blockmap");
  const installer = value.files.find((file) => file.role === "installer");
  if (blockmap && blockmap.name !== installer.name + ".blockmap") throw new Error("\u5DEE\u5206\u6587\u4EF6\u4E0E\u5B89\u88C5\u5668\u4E0D\u5339\u914D");
}
function verifySignedRelease(source, keys, target) {
  if (Buffer.byteLength(source) > 64 * 1024) throw new Error("\u66F4\u65B0\u6E05\u5355\u8FC7\u5927");
  const envelope = JSON.parse(source);
  exact(envelope, ["keyId", "payload", "signature"]);
  if (typeof envelope.keyId !== "string" || !Object.hasOwn(keys, envelope.keyId) || !base64(envelope.signature, 64))
    throw new Error("\u66F4\u65B0\u7B7E\u540D\u6216\u5BC6\u94A5\u4E0D\u53D7\u4FE1\u4EFB");
  const key = createPublicKey(keys[envelope.keyId]);
  if (key.asymmetricKeyType !== "ed25519" || !verify(
    null,
    Buffer.from(canonicalRelease(envelope.payload)),
    key,
    Buffer.from(envelope.signature, "base64")
  ))
    throw new Error("\u66F4\u65B0\u7B7E\u540D\u6821\u9A8C\u5931\u8D25");
  validateReleaseManifest(envelope.payload);
  for (const field of ["product", "channel", "platform"])
    if (envelope.payload[field] !== target[field]) throw new Error("\u66F4\u65B0\u6E05\u5355\u4E0D\u5C5E\u4E8E\u5F53\u524D\u4EA7\u54C1\u3001\u901A\u9053\u6216\u534F\u8BAE\u4EE3\u9645");
  const payload = envelope.payload;
  if (payload.product === "desktop" && !payload.upgradeFromGenerations.includes(target.protocolGeneration))
    throw new Error(`\u5BA2\u6237\u7AEF ${payload.version} \u4E0D\u652F\u6301\u4ECE\u5F53\u524D\u7248\u672C\u76F4\u63A5\u5347\u7EA7\uFF0C\u8BF7\u4ECE\u53D1\u5E03\u9875\u4E0B\u8F7D\u5B89\u88C5\u7A0B\u5E8F\u3002`);
  if (payload.product === "pack" && payload.protocolGeneration > target.protocolGeneration)
    throw new Error(`\u65B0\u7248\u63D2\u4EF6\u5305 ${payload.version} \u9700\u8981\u5148\u66F4\u65B0\u684C\u9762\u5BA2\u6237\u7AEF\uFF1B\u5BA2\u6237\u7AEF\u66F4\u65B0\u540E\u4F1A\u5305\u542B\u5339\u914D\u7684\u63D2\u4EF6\u5305\u3002`);
  if (payload.product === "pack" && payload.protocolGeneration < target.protocolGeneration)
    throw new Error("\u66F4\u65B0\u670D\u52A1\u6682\u65F6\u53EA\u63D0\u4F9B\u8F83\u65E7\u7684\u63D2\u4EF6\u5305\uFF0C\u5F53\u524D\u5DF2\u662F\u53EF\u7528\u7684\u6700\u65B0\u7248\u672C\uFF1B\u8BF7\u7A0D\u540E\u518D\u68C0\u67E5\u3002");
  for (const file of envelope.payload.files) Object.freeze(file);
  Object.freeze(envelope.payload.files);
  Object.freeze(envelope.payload.upgradeFromGenerations);
  return Object.freeze(envelope.payload);
}

// packages/dsh-px-updater/src/version.ts
var import_valid = __toESM(require_valid(), 1);
var import_gt = __toESM(require_gt(), 1);
function isNewer(candidate, current) {
  if (typeof candidate !== "string" || typeof current !== "string") return false;
  const a = (0, import_valid.default)(candidate.trim());
  const b = (0, import_valid.default)(current.trim());
  return a !== null && b !== null && (0, import_gt.default)(a, b);
}

// packages/dsh-px-updater/src/pack-feed.ts
var PACK_FEED_URL = "https://raw.githubusercontent.com/Palbudir/dsh-px/updates/pack-preview.json";
var PACK_FEED_KEYS = Object.freeze({ ...update_keys_default.keys });
var PACK_TARGET = Object.freeze({
  product: "pack",
  channel: "preview",
  platform: "any",
  protocolGeneration: products_default.protocolGeneration
});
function packReleaseUrl(manifest) {
  return `https://github.com/Palbudir/dsh-px/releases/tag/${manifest.product}-v${encodeURIComponent(manifest.version)}`;
}
function evaluatePackFeed(source, currentPack, now = /* @__PURE__ */ new Date(), keys = PACK_FEED_KEYS) {
  const result = {
    checkedAt: now.toISOString(),
    current: { pack: currentPack },
    latest: { pack: null, hostVersion: null, issuedAt: null },
    updateAvailable: false,
    releaseUrl: null,
    install: "manual",
    error: null
  };
  let manifest;
  try {
    manifest = verifySignedRelease(source, keys, PACK_TARGET);
  } catch (error) {
    result.error = `\u7B7E\u540D\u66F4\u65B0\u6E05\u5355\u672A\u901A\u8FC7\u6821\u9A8C\uFF1A${error instanceof Error ? error.message : String(error)}`;
    return result;
  }
  result.latest = { pack: manifest.version, hostVersion: manifest.hostVersion, issuedAt: manifest.issuedAt };
  result.releaseUrl = packReleaseUrl(manifest);
  result.updateAvailable = isNewer(manifest.version, currentPack);
  return result;
}

// packages/dsh-px-updater/src/index.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// packages/dsh-px-updater/package.json
var package_default = {
  name: "dsh-px-updater",
  version: "0.4.2-alpha.1",
  private: true,
  description: "DSH-PX \u7684\u7248\u672C\u63D2\u4EF6\uFF1A\u62A5\u544A Pack \u7248\u672C\u3001\u6821\u9A8C\u7B7E\u540D Pack \u66F4\u65B0\u6E05\u5355\u5E76\u5728 dsh \u8BBE\u7F6E\u9875\u63D0\u793A\uFF0C\u4E0D\u81EA\u52A8\u5B89\u88C5",
  type: "module",
  main: "lib/index.js",
  exports: {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json"
  },
  files: [
    "lib",
    "cordis.patch.yml",
    "locale",
    "icon.svg"
  ],
  license: "MIT",
  dsh: {
    bundle: {
      patch: "./cordis.patch.yml"
    },
    client: {
      platform: "web",
      inject: [
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-locale"
      ]
    }
  },
  icon: "./icon.svg"
};

// packages/dsh-px-updater/src/index.ts
var name = "dsh-px-updater";
var inject = [];
var DEFAULTS = {
  repository: "Palbudir/dsh-px",
  timeoutMs: 8e3,
  registerTool: true,
  routePrefix: "/dsh-px-updater",
  feedUrl: PACK_FEED_URL
};
function readPackIdentity(start = dirname(fileURLToPath(import.meta.url))) {
  const empty = {
    version: null,
    hostVersion: null,
    upstreamCommit: null,
    candidate: null,
    manifestPath: null
  };
  let here = start;
  for (let i = 0; i < 8; i += 1) {
    const core = join(here, "dsh-px-core/package.json");
    const manifestPath = existsSync(core) ? core : join(here, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const m = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (m.name === "dsh-px-pack" || m.name === "dsh-px-core")
          return {
            version: typeof m.version === "string" ? m.version : null,
            hostVersion: typeof m.dshPx?.hostVersion === "string" ? m.dshPx.hostVersion : null,
            upstreamCommit: typeof m.dshPx?.upstreamCommit === "string" ? m.dshPx.upstreamCommit : null,
            candidate: typeof m.dshPx?.candidate === "boolean" ? m.dshPx.candidate : null,
            manifestPath
          };
      } catch {
      }
    }
    const parent = dirname(here);
    if (parent === here) break;
    here = parent;
  }
  return empty;
}
async function checkPackUpdates(config) {
  try {
    return evaluatePackFeed(await fetchMetadataText(config.feedUrl, config.timeoutMs), package_default.version);
  } catch (error) {
    return {
      checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
      current: { pack: package_default.version },
      latest: { pack: null, hostVersion: null, issuedAt: null },
      updateAvailable: false,
      releaseUrl: null,
      install: "manual",
      error: `\u65E0\u6CD5\u8BFB\u53D6 Pack \u66F4\u65B0\u6E05\u5355\uFF1A${errText(error)}`
    };
  }
}
function errText(err) {
  return err instanceof Error ? err.message : String(err);
}
function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...rawConfig ?? {} };
  config.feedUrl = DEFAULTS.feedUrl;
  config.repository = DEFAULTS.repository;
  config.routePrefix = DEFAULTS.routePrefix;
  const pack = readPackIdentity();
  const say = (msg) => {
    try {
      const sink = ctx.logger?.info ?? ctx.logger?.debug ?? console.log;
      sink.call(ctx.logger ?? console, `[dsh-px-updater] ${msg}`);
    } catch {
    }
  };
  say(`\u5DF2\u52A0\u8F7D\uFF08Pack ${pack.version ?? package_default.version}\uFF0C${process.platform}\uFF09`);
  ctx.inject(["connection", "webServer"], (hostCtx) => {
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
      handler: (req, res) => {
        if (rejectUnauthenticatedRequest(req, res, hostCtx.connection)) return;
        sendJson(res, 200, {
          plugin: name,
          version: package_default.version,
          pack: { version: pack.version, hostVersion: pack.hostVersion, candidate: pack.candidate },
          platform: process.platform,
          feed: config.feedUrl,
          repository: config.repository,
          managedDesktop: process.env.DSH_PX_MANAGED_PACK === "1"
        });
      }
    });
    const disposeCheck = webServer.register({
      kind: "exact",
      path: `${config.routePrefix}/check`,
      handler: async (req, res) => {
        if (rejectUnauthenticatedRequest(req, res, hostCtx.connection)) return;
        sendJson(res, 200, await checkPackUpdates(config));
      }
    });
    say(`\u5DF2\u6CE8\u518C HTTP \u7AEF\u70B9 ${config.routePrefix}/{status,check}`);
    hostCtx.effect?.(
      () => () => {
        disposeStatus();
        disposeCheck();
      },
      "dsh-px-updater: http routes"
    );
  });
  if (config.registerTool) {
    ctx.inject(["tools"], (toolCtx) => {
      toolCtx.tools?.register({
        name: "dsh_px_version",
        description: "\u67E5\u8BE2\u5F53\u524D DSH-PX Pack \u7684\u7248\u672C\uFF0C\u5E76\u901A\u8FC7\u7B7E\u540D\u66F4\u65B0\u6E05\u5355\u68C0\u67E5\u662F\u5426\u6709\u65B0\u7684 Pack \u9884\u89C8\u7248\u672C\uFF08\u53EA\u63D0\u793A\uFF0C\u4E0D\u81EA\u52A8\u5B89\u88C5\uFF1B\u684C\u9762\u5BA2\u6237\u7AEF\u66F4\u65B0\u7531\u5BA2\u6237\u7AEF\u81EA\u8EAB\u8D1F\u8D23\uFF09\u3002",
        // Standard JSON Schema: `required` is a root-level array, never a per-property boolean.
        parameters: {
          type: "object",
          properties: {
            checkRemote: {
              type: "boolean",
              description: "\u662F\u5426\u8054\u7F51\u67E5\u8BE2\u7B7E\u540D\u66F4\u65B0\u6E05\u5355\u3002\u4F20 false \u65F6\u53EA\u8FD4\u56DE\u672C\u5730\u7248\u672C\u4FE1\u606F\u3002"
            }
          },
          additionalProperties: false
        },
        output: {
          schema: { type: "string" },
          render: (_args, value) => [{ type: "text", text: value }]
        },
        async execute(args) {
          const local = `\u5F53\u524D\uFF1APack ${package_default.version}\uFF08\u58F0\u660E\u5BBF\u4E3B ${pack.hostVersion ?? "\u672A\u77E5"}\uFF0C${process.platform}\uFF09`;
          if (args?.checkRemote === false) return local;
          const r = await checkPackUpdates(config);
          const lines = [local];
          if (r.error !== null) lines.push(`\u68C0\u67E5\u5931\u8D25\uFF1A${r.error}`);
          else {
            lines.push(`\u5DF2\u7B7E\u540D\u7684\u6700\u65B0 Pack\uFF1A${r.latest.pack}`);
            lines.push(`\u53EF\u66F4\u65B0\uFF1A${r.updateAvailable ? "\u662F\uFF08\u8BF7\u901A\u8FC7\u63D2\u4EF6\u7BA1\u7406\u5668\u624B\u52A8\u5B89\u88C5\uFF09" : "\u5426"}`);
            if (r.releaseUrl !== null) lines.push(`\u53D1\u5E03\u9875\uFF1A${r.releaseUrl}`);
          }
          return lines.join("\n");
        }
      });
    });
  }
}
export {
  DEFAULTS,
  apply,
  checkPackUpdates,
  inject,
  name,
  readPackIdentity
};
