window.__ModuleLoader__.load({
	id: "dsh-px-workbench",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/picocolors/picocolors.browser.js
var require_picocolors_browser = __commonJS({
  "node_modules/picocolors/picocolors.browser.js"(exports, module2) {
    var x = String;
    var create = function() {
      return { isColorSupported: false, reset: x, bold: x, dim: x, italic: x, underline: x, inverse: x, hidden: x, strikethrough: x, black: x, red: x, green: x, yellow: x, blue: x, magenta: x, cyan: x, white: x, gray: x, bgBlack: x, bgRed: x, bgGreen: x, bgYellow: x, bgBlue: x, bgMagenta: x, bgCyan: x, bgWhite: x, blackBright: x, redBright: x, greenBright: x, yellowBright: x, blueBright: x, magentaBright: x, cyanBright: x, whiteBright: x, bgBlackBright: x, bgRedBright: x, bgGreenBright: x, bgYellowBright: x, bgBlueBright: x, bgMagentaBright: x, bgCyanBright: x, bgWhiteBright: x };
    };
    module2.exports = create();
    module2.exports.createColors = create;
  }
});

// (disabled):node_modules/postcss/lib/terminal-highlight
var require_terminal_highlight = __commonJS({
  "(disabled):node_modules/postcss/lib/terminal-highlight"() {
  }
});

// node_modules/postcss/lib/css-syntax-error.js
var require_css_syntax_error = __commonJS({
  "node_modules/postcss/lib/css-syntax-error.js"(exports, module2) {
    "use strict";
    var pico = require_picocolors_browser();
    var terminalHighlight = require_terminal_highlight();
    var CssSyntaxError2 = class _CssSyntaxError extends Error {
      constructor(message, line, column, source, file, plugin2) {
        super(message);
        this.name = "CssSyntaxError";
        this.reason = message;
        if (file) {
          this.file = file;
        }
        if (source) {
          this.source = source;
        }
        if (plugin2) {
          this.plugin = plugin2;
        }
        if (typeof line !== "undefined" && typeof column !== "undefined") {
          if (typeof line === "number") {
            this.line = line;
            this.column = column;
          } else {
            this.line = line.line;
            this.column = line.column;
            this.endLine = column.line;
            this.endColumn = column.column;
          }
        }
        this.setMessage();
        if (Error.captureStackTrace) {
          Error.captureStackTrace(this, _CssSyntaxError);
        }
      }
      setMessage() {
        this.message = this.plugin ? this.plugin + ": " : "";
        this.message += this.file ? this.file : "<css input>";
        if (typeof this.line !== "undefined") {
          this.message += ":" + this.line + ":" + this.column;
        }
        this.message += ": " + this.reason;
      }
      showSourceCode(color) {
        if (!this.source) return "";
        let css = this.source;
        if (color == null) color = pico.isColorSupported;
        let aside = (text) => text;
        let mark = (text) => text;
        let highlight = (text) => text;
        if (color) {
          let { bold, gray, red } = pico.createColors(true);
          mark = (text) => bold(red(text));
          aside = (text) => gray(text);
          if (terminalHighlight) {
            highlight = (text) => terminalHighlight(text);
          }
        }
        let lines = css.split(/\r?\n/);
        let start = Math.max(this.line - 3, 0);
        let end = Math.min(this.line + 2, lines.length);
        let maxWidth = String(end).length;
        return lines.slice(start, end).map((line, index) => {
          let number = start + 1 + index;
          let gutter = " " + (" " + number).slice(-maxWidth) + " | ";
          if (number === this.line) {
            if (line.length > 160) {
              let padding = 20;
              let subLineStart = Math.max(0, this.column - padding);
              let subLineEnd = Math.max(
                this.column + padding,
                this.endColumn + padding
              );
              let subLine = line.slice(subLineStart, subLineEnd);
              let spacing2 = aside(gutter.replace(/\d/g, " ")) + line.slice(0, Math.min(this.column - 1, padding - 1)).replace(/[^\t]/g, " ");
              return mark(">") + aside(gutter) + highlight(subLine) + "\n " + spacing2 + mark("^");
            }
            let spacing = aside(gutter.replace(/\d/g, " ")) + line.slice(0, this.column - 1).replace(/[^\t]/g, " ");
            return mark(">") + aside(gutter) + highlight(line) + "\n " + spacing + mark("^");
          }
          return " " + aside(gutter) + highlight(line);
        }).join("\n");
      }
      toString() {
        let code = this.showSourceCode();
        if (code) {
          code = "\n\n" + code + "\n";
        }
        return this.name + ": " + this.message + code;
      }
    };
    module2.exports = CssSyntaxError2;
    CssSyntaxError2.default = CssSyntaxError2;
  }
});

// node_modules/postcss/lib/stringifier.js
var require_stringifier = __commonJS({
  "node_modules/postcss/lib/stringifier.js"(exports, module2) {
    "use strict";
    var AT_NAME_END = /[\t\n\f\r "#'()/;[\\\]{}]/;
    var DEFAULT_RAW = {
      after: "\n",
      beforeClose: "\n",
      beforeComment: "\n",
      beforeDecl: "\n",
      beforeOpen: " ",
      beforeRule: "\n",
      colon: ": ",
      commentLeft: " ",
      commentRight: " ",
      emptyBody: "",
      indent: "    ",
      semicolon: false
    };
    function capitalize(str) {
      return str[0].toUpperCase() + str.slice(1);
    }
    function atruleStart(str, node) {
      let name = "@" + node.name;
      let params = node.params ? str.rawValue(node, "params") : "";
      let afterName = node.raws.afterName;
      if (typeof afterName === "undefined") {
        afterName = params ? " " : "";
      } else if (afterName === "" && params && !AT_NAME_END.test(params[0])) {
        afterName = " ";
      }
      return name + afterName + params;
    }
    function isCustomProperty(node) {
      if (!node.prop.startsWith("--")) return false;
      let before = node.raws.before;
      return typeof before === "undefined" || !/[^\s;]$/.test(before);
    }
    function pushBody(str, stack, node) {
      let nodes = node.nodes;
      let last = nodes.length - 1;
      while (last > 0) {
        if (nodes[last].type !== "comment") break;
        last -= 1;
      }
      let semicolon = str.raw(node, "semicolon");
      let isDocument = node.type === "document";
      for (let i = nodes.length - 1; i >= 0; i--) {
        let child = nodes[i];
        let childSemicolon = last !== i || semicolon;
        if (!childSemicolon && i < nodes.length - 1 && (child.type === "atrule" && !child.nodes || child.type === "decl" && isCustomProperty(child))) {
          childSemicolon = true;
        }
        stack.push({
          document: isDocument,
          node: child,
          semicolon: childSemicolon
        });
      }
    }
    function pushBlock(str, stack, node, start) {
      let between = str.raw(node, "between", "beforeOpen");
      str.builder(start + between + "{", node, "start");
      let hasNodes = node.nodes && node.nodes.length;
      let close = () => {
        let after = hasNodes ? str.raw(node, "after") : str.raw(node, "after", "emptyBody");
        if (after) str.builder(after);
        str.builder("}", node, "end");
        if (node.type === "rule" && node.raws.ownSemicolon) {
          str.builder(node.raws.ownSemicolon, node, "end");
        }
      };
      if (hasNodes) {
        stack.push(close);
        pushBody(str, stack, node);
      } else {
        close();
      }
    }
    var Stringifier = class _Stringifier {
      constructor(builder) {
        this.builder = builder;
      }
      atrule(node, semicolon) {
        let start = atruleStart(this, node);
        if (node.nodes) {
          this.block(node, start);
        } else {
          let end = (node.raws.between || "") + (semicolon ? ";" : "");
          this.builder(start + end, node);
        }
      }
      beforeAfter(node, detect) {
        let value;
        if (node.type === "decl") {
          value = this.raw(node, null, "beforeDecl");
        } else if (node.type === "comment") {
          value = this.raw(node, null, "beforeComment");
        } else if (detect === "before") {
          value = this.raw(node, null, "beforeRule");
        } else {
          value = this.raw(node, null, "beforeClose");
        }
        let buf = node.parent;
        let depth = 0;
        while (buf && buf.type !== "root") {
          depth += 1;
          buf = buf.parent;
        }
        if (value.includes("\n")) {
          let indent = this.raw(node, null, "indent");
          if (indent.length) {
            for (let step = 0; step < depth; step++) value += indent;
          }
        }
        return value;
      }
      block(node, start) {
        let between = this.raw(node, "between", "beforeOpen");
        this.builder(start + between + "{", node, "start");
        let after;
        if (node.nodes && node.nodes.length) {
          this.body(node);
          after = this.raw(node, "after");
        } else {
          after = this.raw(node, "after", "emptyBody");
        }
        if (after) this.builder(after);
        this.builder("}", node, "end");
      }
      body(node) {
        let proto = _Stringifier.prototype;
        let expandable = ["atrule", "block", "body", "rule", "stringify"].every(
          (method) => this[method] === proto[method]
        );
        let stack = [];
        pushBody(this, stack, node);
        while (stack.length > 0) {
          let entry = stack.pop();
          if (typeof entry === "function") {
            entry();
            continue;
          }
          let child = entry.node;
          let before = this.raw(child, "before");
          if (before) {
            this.builder(before);
          }
          if (expandable && child.type === "rule") {
            pushBlock(this, stack, child, this.rawValue(child, "selector"));
          } else if (expandable && child.type === "atrule" && child.nodes) {
            pushBlock(this, stack, child, atruleStart(this, child));
          } else {
            this.stringify(child, entry.semicolon);
          }
        }
      }
      comment(node) {
        let left = this.raw(node, "left", "commentLeft");
        let right = this.raw(node, "right", "commentRight");
        this.builder("/*" + left + node.text + right + "*/", node);
      }
      decl(node, semicolon) {
        let raws = node.raws;
        let between = this.raw(node, "between", "colon");
        let string = node.prop + between + this.rawValue(node, "value");
        if (node.important) {
          string += raws.important || " !important";
        }
        if (semicolon) string += ";";
        this.builder(string, node);
      }
      document(node) {
        this.body(node);
      }
      raw(node, own, detect) {
        let value;
        if (!detect) detect = own;
        if (own) {
          value = node.raws[own];
          if (typeof value !== "undefined") return value;
        }
        let parent = node.parent;
        if (detect === "before") {
          if (!parent || parent.type === "root" && parent.first === node) {
            return "";
          }
          if (parent && parent.type === "document") {
            return "";
          }
        }
        if (!parent) return DEFAULT_RAW[detect];
        let root2 = node.root();
        let cache = root2.rawCache || (root2.rawCache = {});
        if (typeof cache[detect] !== "undefined") {
          return cache[detect];
        }
        if (detect === "before" || detect === "after") {
          return this.beforeAfter(node, detect);
        } else {
          let method = "raw" + capitalize(detect);
          if (this[method]) {
            value = this[method](root2, node);
          } else {
            root2.walk((i) => {
              value = i.raws[own];
              if (typeof value !== "undefined") return false;
            });
          }
        }
        if (typeof value === "undefined") value = DEFAULT_RAW[detect];
        cache[detect] = value;
        return value;
      }
      rawBeforeClose(root2) {
        let value;
        root2.walk((i) => {
          if (i.nodes && i.nodes.length > 0) {
            if (typeof i.raws.after !== "undefined") {
              value = i.raws.after;
              if (value.includes("\n")) {
                value = value.replace(/[^\n]+$/, "");
              }
              return false;
            }
          }
        });
        if (value) value = value.replace(/\S/g, "");
        return value;
      }
      rawBeforeComment(root2, node) {
        let value;
        root2.walkComments((i) => {
          if (typeof i.raws.before !== "undefined") {
            value = i.raws.before;
            if (value.includes("\n")) {
              value = value.replace(/[^\n]+$/, "");
            }
            return false;
          }
        });
        if (typeof value === "undefined") {
          value = this.raw(node, null, "beforeDecl");
        } else if (value) {
          value = value.replace(/\S/g, "");
        }
        return value;
      }
      rawBeforeDecl(root2, node) {
        let value;
        root2.walkDecls((i) => {
          if (typeof i.raws.before !== "undefined") {
            value = i.raws.before;
            if (value.includes("\n")) {
              value = value.replace(/[^\n]+$/, "");
            }
            return false;
          }
        });
        if (typeof value === "undefined") {
          value = this.raw(node, null, "beforeRule");
        } else if (value) {
          value = value.replace(/\S/g, "");
        }
        return value;
      }
      rawBeforeOpen(root2) {
        let value;
        root2.walk((i) => {
          if (i.type !== "decl") {
            value = i.raws.between;
            if (typeof value !== "undefined") return false;
          }
        });
        return value;
      }
      rawBeforeRule(root2) {
        let value;
        root2.walk((i) => {
          if (i.nodes && (i.parent !== root2 || root2.first !== i)) {
            if (typeof i.raws.before !== "undefined") {
              value = i.raws.before;
              if (value.includes("\n")) {
                value = value.replace(/[^\n]+$/, "");
              }
              return false;
            }
          }
        });
        if (value) value = value.replace(/\S/g, "");
        return value;
      }
      rawColon(root2) {
        let value;
        root2.walkDecls((i) => {
          if (typeof i.raws.between !== "undefined") {
            value = i.raws.between.replace(/[^\s:]/g, "");
            return false;
          }
        });
        return value;
      }
      rawEmptyBody(root2) {
        let value;
        root2.walk((i) => {
          if (i.nodes && i.nodes.length === 0) {
            value = i.raws.after;
            if (typeof value !== "undefined") return false;
          }
        });
        return value;
      }
      rawIndent(root2) {
        if (root2.raws.indent) return root2.raws.indent;
        let value;
        root2.walk((i) => {
          let p = i.parent;
          if (p && p !== root2 && p.parent && p.parent === root2) {
            if (typeof i.raws.before !== "undefined") {
              let parts = i.raws.before.split("\n");
              value = parts[parts.length - 1];
              value = value.replace(/\S/g, "");
              return false;
            }
          }
        });
        return value;
      }
      rawSemicolon(root2) {
        let value;
        root2.walk((i) => {
          if (i.nodes && i.nodes.length && i.last.type === "decl") {
            value = i.raws.semicolon;
            if (typeof value !== "undefined") return false;
          }
        });
        return value;
      }
      rawValue(node, prop) {
        let value = node[prop];
        let raw = node.raws[prop];
        if (raw && raw.value === value) {
          return raw.raw;
        }
        return value;
      }
      root(node) {
        let inDocument = node.parent && node.parent.type === "document";
        if (!inDocument && node.source && node.source.input.hasBOM) {
          this.builder("\uFEFF", node, "start");
        }
        this.body(node);
        if (node.raws.after) {
          this.builder(node.raws.after);
        }
      }
      rule(node) {
        this.block(node, this.rawValue(node, "selector"));
        if (node.raws.ownSemicolon) {
          this.builder(node.raws.ownSemicolon, node, "end");
        }
      }
      stringify(node, semicolon) {
        if (!this[node.type]) {
          throw new Error(
            "Unknown AST node type " + node.type + ". Maybe you need to change PostCSS stringifier."
          );
        }
        this[node.type](node, semicolon);
      }
    };
    module2.exports = Stringifier;
    Stringifier.default = Stringifier;
  }
});

// node_modules/postcss/lib/stringify.js
var require_stringify = __commonJS({
  "node_modules/postcss/lib/stringify.js"(exports, module2) {
    "use strict";
    var Stringifier = require_stringifier();
    var STYLE_TAG = /(<)(\/?style\b)/gi;
    var COMMENT_OPEN = /(<)(!--)/g;
    function escapeHTMLInCSS(str) {
      if (!str.includes("<")) return str;
      return str.replace(STYLE_TAG, "\\3c $2").replace(COMMENT_OPEN, "\\3c $2");
    }
    var SafeStringifier = class extends Stringifier {
      escapeHTML(node, print) {
        let builder = this.builder;
        let chunks, css;
        this.builder = (str, child, type) => {
          if (chunks) {
            css += str;
            chunks.push(str, child, type);
          } else if (str.includes("<")) {
            css = str;
            chunks = [str, child, type];
          } else {
            builder(str, child, type);
          }
        };
        print();
        this.builder = builder;
        if (!chunks) return;
        let escaped = escapeHTMLInCSS(css);
        if (escaped === css) {
          for (let i = 0; i < chunks.length; i += 3) {
            builder(chunks[i], chunks[i + 1], chunks[i + 2]);
          }
        } else {
          builder(escaped, node, "start");
        }
      }
      root(node) {
        if (node.parent && node.parent.type === "document") {
          this.escapeHTML(node, () => this.body(node));
          if (node.raws.after) this.builder(node.raws.after);
        } else {
          this.escapeHTML(node, () => super.root(node));
        }
      }
    };
    function stringify2(node, builder) {
      let str = new SafeStringifier(builder);
      if (node.type === "root" || node.type === "document") {
        str.stringify(node);
      } else {
        str.escapeHTML(node, () => str.stringify(node));
      }
    }
    module2.exports = stringify2;
    stringify2.default = stringify2;
  }
});

// node_modules/postcss/lib/symbols.js
var require_symbols = __commonJS({
  "node_modules/postcss/lib/symbols.js"(exports, module2) {
    "use strict";
    module2.exports.isClean = Symbol("isClean");
    module2.exports.my = Symbol("my");
  }
});

// node_modules/postcss/lib/node.js
var require_node = __commonJS({
  "node_modules/postcss/lib/node.js"(exports, module2) {
    "use strict";
    var CssSyntaxError2 = require_css_syntax_error();
    var Stringifier = require_stringifier();
    var stringify2 = require_stringify();
    var { isClean, my } = require_symbols();
    function cloneNode(obj, parent) {
      let cloned = new obj.constructor();
      let stack = [[obj, cloned, parent]];
      while (stack.length > 0) {
        let [source, target, targetParent] = stack.pop();
        for (let i in source) {
          if (!Object.prototype.hasOwnProperty.call(source, i)) {
            continue;
          }
          if (i === "proxyCache") continue;
          let value = source[i];
          let type = typeof value;
          if (i === "parent" && type === "object") {
            if (targetParent) target[i] = targetParent;
          } else if (i === "source") {
            target[i] = value;
          } else if (Array.isArray(value)) {
            let children = [];
            target[i] = children;
            for (let j of value) {
              let childClone = new j.constructor();
              children.push(childClone);
              stack.push([j, childClone, target]);
            }
          } else {
            if (type === "object" && value !== null) {
              let valueClone = new value.constructor();
              stack.push([value, valueClone, void 0]);
              value = valueClone;
            }
            target[i] = value;
          }
        }
      }
      return cloned;
    }
    function sourceOffset(inputCSS, position) {
      if (position && typeof position.offset !== "undefined") {
        return position.offset;
      }
      let column = 1;
      let line = 1;
      let offset = 0;
      for (let i = 0; i < inputCSS.length; i++) {
        if (line === position.line && column === position.column) {
          offset = i;
          break;
        }
        if (inputCSS[i] === "\n") {
          column = 1;
          line += 1;
        } else {
          column += 1;
        }
      }
      return offset;
    }
    var Node2 = class _Node {
      get proxyOf() {
        return this;
      }
      constructor(defaults = {}) {
        this.raws = {};
        this[isClean] = false;
        this[my] = true;
        for (let name of Object.keys(defaults)) {
          if (name === "__proto__") continue;
          if (name === "nodes") {
            this.nodes = [];
            for (let node of defaults[name]) {
              if (typeof node.clone === "function" && node.parent) {
                this.append(node.clone());
              } else {
                this.append(node);
              }
            }
          } else {
            this[name] = defaults[name];
          }
        }
      }
      addToError(error) {
        error.postcssNode = this;
        if (error.stack && this.source && /\n\s{4}at /.test(error.stack)) {
          let s = this.source;
          error.stack = error.stack.replace(
            /\n\s{4}at /,
            `$&${s.input.from}:${s.start.line}:${s.start.column}$&`
          );
        }
        return error;
      }
      after(add) {
        this.parent.insertAfter(this, add);
        return this;
      }
      assign(overrides = {}) {
        for (let name in overrides) {
          this[name] = overrides[name];
        }
        return this;
      }
      before(add) {
        this.parent.insertBefore(this, add);
        return this;
      }
      cleanRaws(keepBetween) {
        delete this.raws.before;
        delete this.raws.after;
        if (!keepBetween) delete this.raws.between;
      }
      clone(overrides = {}) {
        let cloned = cloneNode(this);
        for (let name in overrides) {
          cloned[name] = overrides[name];
        }
        return cloned;
      }
      cloneAfter(overrides = {}) {
        let cloned = this.clone(overrides);
        this.parent.insertAfter(this, cloned);
        return cloned;
      }
      cloneBefore(overrides = {}) {
        let cloned = this.clone(overrides);
        this.parent.insertBefore(this, cloned);
        return cloned;
      }
      error(message, opts = {}) {
        if (this.source) {
          let { end, start } = this.rangeBy(opts);
          return this.source.input.error(
            message,
            { column: start.column, line: start.line },
            { column: end.column, line: end.line },
            opts
          );
        }
        return new CssSyntaxError2(message);
      }
      getProxyProcessor() {
        return {
          get(node, prop) {
            if (prop === "proxyOf") {
              return node;
            } else if (prop === "root") {
              return () => node.root().toProxy();
            } else {
              return node[prop];
            }
          },
          set(node, prop, value) {
            if (node[prop] === value) return true;
            node[prop] = value;
            if (prop === "prop" || prop === "value" || prop === "name" || prop === "params" || prop === "important" || /* c8 ignore next */
            prop === "text") {
              node.markDirty();
            }
            return true;
          }
        };
      }
      /* c8 ignore next 3 */
      markClean() {
        this[isClean] = true;
      }
      markDirty() {
        if (this[isClean]) {
          this[isClean] = false;
          let next = this;
          while (next = next.parent) {
            next[isClean] = false;
          }
        }
      }
      next() {
        if (!this.parent) return void 0;
        let index = this.parent.index(this);
        return this.parent.nodes[index + 1];
      }
      positionBy(opts = {}) {
        let inputString = "document" in this.source.input ? this.source.input.document : this.source.input.css;
        let pos = {
          column: this.source.start.column,
          line: this.source.start.line,
          offset: sourceOffset(inputString, this.source.start)
        };
        if (opts.index) {
          pos = this.positionInside(opts.index);
        } else if (opts.word) {
          let stringRepresentation = inputString.slice(
            sourceOffset(inputString, this.source.start),
            sourceOffset(inputString, this.source.end)
          );
          let index = stringRepresentation.indexOf(opts.word);
          if (index !== -1) pos = this.positionInside(index);
        }
        return pos;
      }
      positionInside(index) {
        let column = this.source.start.column;
        let line = this.source.start.line;
        let inputString = "document" in this.source.input ? this.source.input.document : this.source.input.css;
        let offset = sourceOffset(inputString, this.source.start);
        let end = offset + index;
        for (let i = offset; i < end; i++) {
          if (inputString[i] === "\n") {
            column = 1;
            line += 1;
          } else {
            column += 1;
          }
        }
        return { column, line, offset: end };
      }
      prev() {
        if (!this.parent) return void 0;
        let index = this.parent.index(this);
        return this.parent.nodes[index - 1];
      }
      rangeBy(opts = {}) {
        let inputString = "document" in this.source.input ? this.source.input.document : this.source.input.css;
        let start = {
          column: this.source.start.column,
          line: this.source.start.line,
          offset: sourceOffset(inputString, this.source.start)
        };
        let end = this.source.end ? {
          column: this.source.end.column + 1,
          line: this.source.end.line,
          offset: typeof this.source.end.offset === "number" ? (
            // `source.end.offset` is exclusive, so we don't need to add 1
            this.source.end.offset
          ) : (
            // Since line/column in this.source.end is inclusive,
            // the `sourceOffset(... , this.source.end)` returns an inclusive offset.
            // So, we add 1 to convert it to exclusive.
            sourceOffset(inputString, this.source.end) + 1
          )
        } : {
          column: start.column + 1,
          line: start.line,
          offset: start.offset + 1
        };
        if (opts.word) {
          let stringRepresentation = inputString.slice(
            sourceOffset(inputString, this.source.start),
            sourceOffset(inputString, this.source.end)
          );
          let index = stringRepresentation.indexOf(opts.word);
          if (index !== -1) {
            start = this.positionInside(index);
            end = this.positionInside(index + opts.word.length);
          }
        } else {
          if (opts.start) {
            start = {
              column: opts.start.column,
              line: opts.start.line,
              offset: sourceOffset(inputString, opts.start)
            };
          } else if (typeof opts.index === "number") {
            start = this.positionInside(opts.index);
          }
          if (opts.end) {
            end = {
              column: opts.end.column,
              line: opts.end.line,
              offset: sourceOffset(inputString, opts.end)
            };
          } else if (typeof opts.endIndex === "number") {
            end = this.positionInside(opts.endIndex);
          } else if (typeof opts.index === "number") {
            end = this.positionInside(opts.index + 1);
          }
        }
        if (end.line < start.line || end.line === start.line && end.column <= start.column) {
          end = {
            column: start.column + 1,
            line: start.line,
            offset: start.offset + 1
          };
        }
        return { end, start };
      }
      raw(prop, defaultType) {
        let str = new Stringifier();
        return str.raw(this, prop, defaultType);
      }
      remove() {
        if (this.parent) {
          this.parent.removeChild(this);
        }
        this.parent = void 0;
        return this;
      }
      replaceWith(...nodes) {
        if (this.parent) {
          let bookmark = this;
          let foundSelf = false;
          for (let node of nodes) {
            if (node === this) {
              foundSelf = true;
            } else if (foundSelf) {
              this.parent.insertAfter(bookmark, node);
              bookmark = node;
            } else {
              this.parent.insertBefore(bookmark, node);
            }
          }
          if (!foundSelf) {
            this.remove();
          }
        }
        return this;
      }
      root() {
        let result = this;
        while (result.parent && result.parent.type !== "document") {
          result = result.parent;
        }
        return result;
      }
      toJSON(_, inputs) {
        let emitInputs = inputs == null;
        inputs = inputs || /* @__PURE__ */ new Map();
        let holderOfRoot = [];
        let queue = [[this, holderOfRoot, 0]];
        for (let step = 0; step < queue.length; step++) {
          let [node, holder, key] = queue[step];
          let fixed2 = {};
          holder[key] = fixed2;
          for (let name in node) {
            if (!Object.prototype.hasOwnProperty.call(node, name)) {
              continue;
            }
            if (name === "parent" || name === "proxyCache") continue;
            let value = node[name];
            if (Array.isArray(value)) {
              let fixedArray = [];
              fixed2[name] = fixedArray;
              for (let i = 0; i < value.length; i++) {
                let item = value[i];
                if (typeof item === "object" && item.toJSON) {
                  if (item.toJSON === _Node.prototype.toJSON) {
                    queue.push([item, fixedArray, i]);
                  } else {
                    fixedArray[i] = item.toJSON(null, inputs);
                  }
                } else {
                  fixedArray[i] = item;
                }
              }
            } else if (typeof value === "object" && value.toJSON) {
              if (value.toJSON === _Node.prototype.toJSON) {
                queue.push([value, fixed2, name]);
              } else {
                fixed2[name] = value.toJSON(null, inputs);
              }
            } else if (name === "source") {
              if (value == null) continue;
              let inputId = inputs.get(value.input);
              if (inputId == null) {
                inputId = inputs.size;
                inputs.set(value.input, inputId);
              }
              fixed2[name] = {
                end: value.end,
                inputId,
                start: value.start
              };
            } else {
              fixed2[name] = value;
            }
          }
        }
        let fixed = holderOfRoot[0];
        if (emitInputs) {
          fixed.inputs = [...inputs.keys()].map((input) => input.toJSON());
        }
        return fixed;
      }
      toProxy() {
        if (!this.proxyCache) {
          this.proxyCache = new Proxy(this, this.getProxyProcessor());
        }
        return this.proxyCache;
      }
      toString(stringifier = stringify2) {
        if (stringifier.stringify) stringifier = stringifier.stringify;
        let result = "";
        stringifier(this, (i) => {
          result += i;
        });
        return result;
      }
      warn(result, text, opts = {}) {
        let data = { node: this };
        for (let i in opts) data[i] = opts[i];
        return result.warn(text, data);
      }
    };
    module2.exports = Node2;
    Node2.default = Node2;
  }
});

// node_modules/postcss/lib/comment.js
var require_comment = __commonJS({
  "node_modules/postcss/lib/comment.js"(exports, module2) {
    "use strict";
    var Node2 = require_node();
    var Comment2 = class extends Node2 {
      constructor(defaults) {
        super(defaults);
        this.type = "comment";
      }
    };
    module2.exports = Comment2;
    Comment2.default = Comment2;
  }
});

// node_modules/postcss/lib/declaration.js
var require_declaration = __commonJS({
  "node_modules/postcss/lib/declaration.js"(exports, module2) {
    "use strict";
    var Node2 = require_node();
    var Declaration2 = class extends Node2 {
      get variable() {
        return this.prop.startsWith("--") || this.prop[0] === "$";
      }
      constructor(defaults) {
        if (defaults && typeof defaults.value !== "undefined" && typeof defaults.value !== "string") {
          defaults = { ...defaults, value: String(defaults.value) };
        }
        super(defaults);
        this.type = "decl";
      }
    };
    module2.exports = Declaration2;
    Declaration2.default = Declaration2;
  }
});

// node_modules/postcss/lib/container.js
var require_container = __commonJS({
  "node_modules/postcss/lib/container.js"(exports, module2) {
    "use strict";
    var Comment2 = require_comment();
    var Declaration2 = require_declaration();
    var Node2 = require_node();
    var { isClean, my } = require_symbols();
    var AtRule2;
    var parse2;
    var Root2;
    var Rule2;
    function cleanSource(nodes) {
      let stack = nodes.slice();
      while (stack.length > 0) {
        let node = stack.pop();
        delete node.source;
        if (node.nodes) {
          node.nodes = node.nodes.slice();
          for (let i of node.nodes) stack.push(i);
        }
      }
      return nodes.slice();
    }
    function markTreeDirty(node) {
      let stack = [node];
      while (stack.length > 0) {
        let next = stack.pop();
        next[isClean] = false;
        if (next.proxyOf.nodes) {
          for (let i of next.proxyOf.nodes) stack.push(i);
        }
      }
    }
    var Container2 = class _Container extends Node2 {
      get first() {
        if (!this.proxyOf.nodes) return void 0;
        return this.proxyOf.nodes[0];
      }
      get last() {
        if (!this.proxyOf.nodes) return void 0;
        return this.proxyOf.nodes[this.proxyOf.nodes.length - 1];
      }
      append(...children) {
        for (let child of children) {
          let nodes = this.normalize(child, this.last);
          for (let node of nodes) this.proxyOf.nodes.push(node);
        }
        this.markDirty();
        return this;
      }
      cleanRaws(keepBetween) {
        let stack = [this];
        while (stack.length > 0) {
          let node = stack.pop();
          if (node !== this && node.cleanRaws !== _Container.prototype.cleanRaws) {
            node.cleanRaws(keepBetween);
            continue;
          }
          Node2.prototype.cleanRaws.call(node, keepBetween);
          if (node.nodes) {
            for (let child of node.nodes) stack.push(child);
          }
        }
      }
      each(callback) {
        if (!this.proxyOf.nodes) return void 0;
        let iterator = this.getIterator();
        let index, result;
        while (this.indexes[iterator] < this.proxyOf.nodes.length) {
          index = this.indexes[iterator];
          result = callback(this.proxyOf.nodes[index], index);
          if (result === false) break;
          this.indexes[iterator] += 1;
        }
        delete this.indexes[iterator];
        return result;
      }
      every(condition) {
        return this.nodes.every(condition);
      }
      getIterator() {
        if (!this.lastEach) this.lastEach = 0;
        if (!this.indexes) this.indexes = {};
        this.lastEach += 1;
        let iterator = this.lastEach;
        this.indexes[iterator] = 0;
        return iterator;
      }
      getProxyProcessor() {
        return {
          get(node, prop) {
            if (prop === "proxyOf") {
              return node;
            } else if (!node[prop]) {
              return node[prop];
            } else if (prop === "each" || typeof prop === "string" && prop.startsWith("walk")) {
              return (...args) => {
                return node[prop](
                  ...args.map((i) => {
                    if (typeof i === "function") {
                      return (child, index) => i(child.toProxy(), index);
                    } else {
                      return i;
                    }
                  })
                );
              };
            } else if (prop === "every" || prop === "some") {
              return (cb) => {
                return node[prop](
                  (child, ...other) => cb(child.toProxy(), ...other)
                );
              };
            } else if (prop === "root") {
              return () => node.root().toProxy();
            } else if (prop === "nodes") {
              return node.nodes.map((i) => i.toProxy());
            } else if (prop === "first" || prop === "last") {
              return node[prop].toProxy();
            } else {
              return node[prop];
            }
          },
          set(node, prop, value) {
            if (node[prop] === value) return true;
            node[prop] = value;
            if (prop === "name" || prop === "params" || prop === "selector") {
              node.markDirty();
            }
            return true;
          }
        };
      }
      index(child) {
        if (typeof child === "number") return child;
        if (child.proxyOf) child = child.proxyOf;
        return this.proxyOf.nodes.indexOf(child);
      }
      insertAfter(exist, add) {
        let existIndex = this.index(exist);
        let nodes = this.normalize(add, this.proxyOf.nodes[existIndex]).reverse();
        existIndex = this.index(exist);
        for (let node of nodes) this.proxyOf.nodes.splice(existIndex + 1, 0, node);
        let index;
        for (let id in this.indexes) {
          index = this.indexes[id];
          if (existIndex < index) {
            this.indexes[id] = index + nodes.length;
          }
        }
        this.markDirty();
        return this;
      }
      insertBefore(exist, add) {
        let existIndex = this.index(exist);
        let type = existIndex === 0 ? "prepend" : false;
        let nodes = this.normalize(
          add,
          this.proxyOf.nodes[existIndex],
          type
        ).reverse();
        existIndex = this.index(exist);
        for (let node of nodes) this.proxyOf.nodes.splice(existIndex, 0, node);
        let index;
        for (let id in this.indexes) {
          index = this.indexes[id];
          if (existIndex <= index) {
            this.indexes[id] = index + nodes.length;
          }
        }
        this.markDirty();
        return this;
      }
      normalize(nodes, sample) {
        if (typeof nodes === "string") {
          nodes = cleanSource(parse2(nodes).nodes);
        } else if (typeof nodes === "undefined") {
          nodes = [];
        } else if (Array.isArray(nodes)) {
          nodes = nodes.slice(0);
          for (let i of nodes) {
            if (i.parent) i.parent.removeChild(i, "ignore");
          }
        } else if (nodes.type === "root" && this.type !== "document") {
          nodes = nodes.nodes.slice(0);
          for (let i of nodes) {
            if (i.parent) i.parent.removeChild(i, "ignore");
          }
        } else if (nodes.type) {
          nodes = [nodes];
        } else if (nodes.prop) {
          if (typeof nodes.value === "undefined") {
            throw new Error("Value field is missed in node creation");
          } else if (typeof nodes.value !== "string") {
            nodes.value = String(nodes.value);
          }
          nodes = [new Declaration2(nodes)];
        } else if (nodes.selector || nodes.selectors) {
          nodes = [new Rule2(nodes)];
        } else if (nodes.name) {
          nodes = [new AtRule2(nodes)];
        } else if (nodes.text) {
          nodes = [new Comment2(nodes)];
        } else {
          throw new Error("Unknown node type in node creation");
        }
        let processed = nodes.map((i) => {
          if (!i[my]) _Container.rebuild(i);
          i = i.proxyOf;
          if (i.parent) i.parent.removeChild(i);
          if (i[isClean]) markTreeDirty(i);
          if (!i.raws) i.raws = {};
          if (typeof i.raws.before === "undefined") {
            if (sample && typeof sample.raws.before !== "undefined") {
              i.raws.before = sample.raws.before.replace(/\S/g, "");
            }
          }
          i.parent = this.proxyOf;
          return i;
        });
        return processed;
      }
      prepend(...children) {
        children = children.reverse();
        for (let child of children) {
          let nodes = this.normalize(child, this.first, "prepend").reverse();
          for (let node of nodes) this.proxyOf.nodes.unshift(node);
          for (let id in this.indexes) {
            this.indexes[id] = this.indexes[id] + nodes.length;
          }
        }
        this.markDirty();
        return this;
      }
      push(child) {
        child.parent = this;
        this.proxyOf.nodes.push(child);
        return this;
      }
      removeAll() {
        for (let node of this.proxyOf.nodes) node.parent = void 0;
        this.proxyOf.nodes = [];
        this.markDirty();
        return this;
      }
      removeChild(child) {
        child = this.index(child);
        this.proxyOf.nodes[child].parent = void 0;
        this.proxyOf.nodes.splice(child, 1);
        let index;
        for (let id in this.indexes) {
          index = this.indexes[id];
          if (index >= child) {
            this.indexes[id] = index - 1;
          }
        }
        this.markDirty();
        return this;
      }
      replaceValues(pattern, opts, callback) {
        if (!callback) {
          callback = opts;
          opts = {};
        }
        this.walkDecls((decl2) => {
          if (opts.props && !opts.props.includes(decl2.prop)) return;
          if (opts.fast && !decl2.value.includes(opts.fast)) return;
          decl2.value = decl2.value.replace(pattern, callback);
        });
        this.markDirty();
        return this;
      }
      some(condition) {
        return this.nodes.some(condition);
      }
      walk(callback) {
        if (!this.proxyOf.nodes) return void 0;
        let stack = [{ iterator: this.getIterator(), node: this.proxyOf }];
        while (stack.length > 0) {
          let { iterator, node } = stack[stack.length - 1];
          let index = node.indexes[iterator];
          if (index >= node.proxyOf.nodes.length) {
            delete node.indexes[iterator];
            stack.pop();
            let parent = stack[stack.length - 1];
            if (parent) parent.node.indexes[parent.iterator] += 1;
            continue;
          }
          let child = node.proxyOf.nodes[index];
          let result;
          try {
            result = callback(child, index);
          } catch (e) {
            throw child.addToError(e);
          }
          if (result === false) {
            for (let opened of stack) {
              delete opened.node.indexes[opened.iterator];
            }
            return false;
          }
          if (child.walk && child.proxyOf.nodes) {
            stack.push({ iterator: child.getIterator(), node: child });
          } else {
            node.indexes[iterator] += 1;
          }
        }
        return void 0;
      }
      walkAtRules(name, callback) {
        if (!callback) {
          callback = name;
          return this.walk((child, i) => {
            if (child.type === "atrule") {
              return callback(child, i);
            }
          });
        }
        if (name instanceof RegExp) {
          return this.walk((child, i) => {
            if (child.type === "atrule" && name.test(child.name)) {
              return callback(child, i);
            }
          });
        }
        return this.walk((child, i) => {
          if (child.type === "atrule" && child.name === name) {
            return callback(child, i);
          }
        });
      }
      walkComments(callback) {
        return this.walk((child, i) => {
          if (child.type === "comment") {
            return callback(child, i);
          }
        });
      }
      walkDecls(prop, callback) {
        if (!callback) {
          callback = prop;
          return this.walk((child, i) => {
            if (child.type === "decl") {
              return callback(child, i);
            }
          });
        }
        if (prop instanceof RegExp) {
          return this.walk((child, i) => {
            if (child.type === "decl" && prop.test(child.prop)) {
              return callback(child, i);
            }
          });
        }
        return this.walk((child, i) => {
          if (child.type === "decl" && child.prop === prop) {
            return callback(child, i);
          }
        });
      }
      walkRules(selector, callback) {
        if (!callback) {
          callback = selector;
          return this.walk((child, i) => {
            if (child.type === "rule") {
              return callback(child, i);
            }
          });
        }
        if (selector instanceof RegExp) {
          return this.walk((child, i) => {
            if (child.type === "rule" && selector.test(child.selector)) {
              return callback(child, i);
            }
          });
        }
        return this.walk((child, i) => {
          if (child.type === "rule" && child.selector === selector) {
            return callback(child, i);
          }
        });
      }
    };
    Container2.registerParse = (dependant) => {
      parse2 = dependant;
    };
    Container2.registerRule = (dependant) => {
      Rule2 = dependant;
    };
    Container2.registerAtRule = (dependant) => {
      AtRule2 = dependant;
    };
    Container2.registerRoot = (dependant) => {
      Root2 = dependant;
    };
    module2.exports = Container2;
    Container2.default = Container2;
    Container2.rebuild = (node) => {
      let stack = [node];
      while (stack.length > 0) {
        let next = stack.pop();
        if (next.type === "atrule") {
          Object.setPrototypeOf(next, AtRule2.prototype);
        } else if (next.type === "rule") {
          Object.setPrototypeOf(next, Rule2.prototype);
        } else if (next.type === "decl") {
          Object.setPrototypeOf(next, Declaration2.prototype);
        } else if (next.type === "comment") {
          Object.setPrototypeOf(next, Comment2.prototype);
        } else if (next.type === "root") {
          Object.setPrototypeOf(next, Root2.prototype);
        }
        next[my] = true;
        if (next.nodes) {
          for (let child of next.nodes) stack.push(child);
        }
      }
    };
  }
});

// node_modules/postcss/lib/at-rule.js
var require_at_rule = __commonJS({
  "node_modules/postcss/lib/at-rule.js"(exports, module2) {
    "use strict";
    var Container2 = require_container();
    var AtRule2 = class extends Container2 {
      constructor(defaults) {
        super(defaults);
        this.type = "atrule";
      }
      append(...children) {
        if (!this.proxyOf.nodes) this.nodes = [];
        return super.append(...children);
      }
      prepend(...children) {
        if (!this.proxyOf.nodes) this.nodes = [];
        return super.prepend(...children);
      }
    };
    module2.exports = AtRule2;
    AtRule2.default = AtRule2;
    Container2.registerAtRule(AtRule2);
  }
});

// node_modules/postcss/lib/document.js
var require_document = __commonJS({
  "node_modules/postcss/lib/document.js"(exports, module2) {
    "use strict";
    var Container2 = require_container();
    var LazyResult;
    var Processor2;
    var Document2 = class extends Container2 {
      constructor(defaults) {
        super({ type: "document", ...defaults });
        if (!this.nodes) {
          this.nodes = [];
        }
      }
      toResult(opts = {}) {
        let lazy = new LazyResult(new Processor2(), this, opts);
        return lazy.stringify();
      }
    };
    Document2.registerLazyResult = (dependant) => {
      LazyResult = dependant;
    };
    Document2.registerProcessor = (dependant) => {
      Processor2 = dependant;
    };
    module2.exports = Document2;
    Document2.default = Document2;
  }
});

// node_modules/nanoid/non-secure/index.cjs
var require_non_secure = __commonJS({
  "node_modules/nanoid/non-secure/index.cjs"(exports, module2) {
    var urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
    var customAlphabet = (alphabet, defaultSize = 21) => {
      return (size = defaultSize) => {
        let id = "";
        let i = size | 0;
        while (i-- > 0) {
          id += alphabet[Math.random() * alphabet.length | 0];
        }
        return id;
      };
    };
    var nanoid = (size = 21) => {
      let id = "";
      let i = size | 0;
      while (i-- > 0) {
        id += urlAlphabet[Math.random() * 64 | 0];
      }
      return id;
    };
    module2.exports = { nanoid, customAlphabet };
  }
});

// (disabled):path
var require_path = __commonJS({
  "(disabled):path"() {
  }
});

// (disabled):node_modules/source-map-js/source-map.js
var require_source_map = __commonJS({
  "(disabled):node_modules/source-map-js/source-map.js"() {
  }
});

// (disabled):url
var require_url = __commonJS({
  "(disabled):url"() {
  }
});

// (disabled):fs
var require_fs = __commonJS({
  "(disabled):fs"() {
  }
});

// node_modules/postcss/lib/previous-map.js
var require_previous_map = __commonJS({
  "node_modules/postcss/lib/previous-map.js"(exports, module2) {
    "use strict";
    var { existsSync, readFileSync, realpathSync } = require_fs();
    var { dirname, isAbsolute, join, relative, sep } = require_path();
    var { SourceMapConsumer, SourceMapGenerator } = require_source_map();
    function realPath(path) {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    }
    function fromBase64(str) {
      if (Buffer) {
        return Buffer.from(str, "base64").toString();
      } else {
        return window.atob(str);
      }
    }
    var PreviousMap = class {
      constructor(css, opts) {
        if (opts.map === false) return;
        if (opts.unsafeMap) this.unsafeMap = true;
        this.loadAnnotation(css);
        this.inline = this.startWith(this.annotation, "data:");
        let prev = opts.map ? opts.map.prev : void 0;
        let text = this.loadMap(opts.from, prev);
        if (!this.mapFile && opts.from) {
          this.mapFile = opts.from;
        }
        if (this.mapFile) this.root = dirname(this.mapFile);
        if (text) this.text = text;
      }
      consumer() {
        if (!this.consumerCache) {
          this.consumerCache = new SourceMapConsumer(this.json || this.text);
        }
        return this.consumerCache;
      }
      decodeInline(text) {
        let baseCharsetUri = /^data:application\/json;charset=utf-?8;base64,/;
        let baseUri = /^data:application\/json;base64,/;
        let charsetUri = /^data:application\/json;charset=utf-?8,/;
        let uri = /^data:application\/json,/;
        let uriMatch = text.match(charsetUri) || text.match(uri);
        if (uriMatch) {
          return decodeURIComponent(text.substr(uriMatch[0].length));
        }
        let baseUriMatch = text.match(baseCharsetUri) || text.match(baseUri);
        if (baseUriMatch) {
          return fromBase64(text.substr(baseUriMatch[0].length));
        }
        let encoding = text.slice("data:application/json;".length);
        encoding = encoding.slice(0, encoding.indexOf(","));
        throw new Error("Unsupported source map encoding " + encoding);
      }
      getAnnotationURL(sourceMapString) {
        return sourceMapString.replace(/^\/\*\s*# sourceMappingURL=/, "").trim();
      }
      isMap(map) {
        if (typeof map !== "object") return false;
        return typeof map.mappings === "string" || typeof map._mappings === "string" || Array.isArray(map.sections);
      }
      loadAnnotation(css) {
        let comments = css.match(/\/\*\s*# sourceMappingURL=/g);
        if (!comments) return;
        let start = css.lastIndexOf(comments.pop());
        let end = css.indexOf("*/", start);
        if (start > -1 && end > -1) {
          this.annotation = this.getAnnotationURL(css.substring(start, end));
        }
      }
      loadFile(path, cssFile, trusted) {
        if (!trusted && !this.unsafeMap) {
          if (!/\.map$/i.test(path)) return void 0;
          if (!cssFile) return void 0;
          let rel = relative(realPath(dirname(cssFile)), realPath(path));
          if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
            return void 0;
          }
        }
        this.root = dirname(path);
        if (existsSync(path)) {
          this.mapFile = path;
          return readFileSync(path, "utf-8").toString().trim();
        }
      }
      loadMap(file, prev) {
        if (prev === false) return false;
        if (prev) {
          if (typeof prev === "string") {
            return prev;
          } else if (typeof prev === "function") {
            let prevPath = prev(file);
            if (prevPath) {
              let map = this.loadFile(prevPath, file, true);
              if (!map) {
                throw new Error(
                  "Unable to load previous source map: " + prevPath.toString()
                );
              }
              return map;
            }
          } else if (prev instanceof SourceMapConsumer) {
            return SourceMapGenerator.fromSourceMap(prev).toString();
          } else if (prev instanceof SourceMapGenerator) {
            return prev.toString();
          } else if (this.isMap(prev)) {
            return JSON.stringify(prev);
          } else {
            throw new Error(
              "Unsupported previous source map format: " + prev.toString()
            );
          }
        } else if (this.inline) {
          return this.decodeInline(this.annotation);
        } else if (this.annotation) {
          let map = this.annotation;
          if (file) map = join(dirname(file), map);
          let unknown = this.loadFile(map, file, false);
          if (unknown) {
            try {
              this.json = JSON.parse(unknown.replace(/^\)]}'[^\n]*\n/, ""));
            } catch {
              return void 0;
            }
          }
          return unknown;
        }
      }
      startWith(string, start) {
        if (!string) return false;
        return string.substr(0, start.length) === start;
      }
      withContent() {
        return !!(this.consumer().sourcesContent && this.consumer().sourcesContent.length > 0);
      }
    };
    module2.exports = PreviousMap;
    PreviousMap.default = PreviousMap;
  }
});

// node_modules/postcss/lib/input.js
var require_input = __commonJS({
  "node_modules/postcss/lib/input.js"(exports, module2) {
    "use strict";
    var { nanoid } = require_non_secure();
    var { isAbsolute, resolve } = require_path();
    var { SourceMapConsumer, SourceMapGenerator } = require_source_map();
    var { fileURLToPath, pathToFileURL } = require_url();
    var CssSyntaxError2 = require_css_syntax_error();
    var PreviousMap = require_previous_map();
    var terminalHighlight = require_terminal_highlight();
    var lineToIndexCache = Symbol("lineToIndexCache");
    var sourceMapAvailable = Boolean(SourceMapConsumer && SourceMapGenerator);
    var pathAvailable = Boolean(resolve && isAbsolute);
    function getLineToIndex(input) {
      if (input[lineToIndexCache]) return input[lineToIndexCache];
      let lines = input.css.split("\n");
      let lineToIndex = new Array(lines.length);
      let prevIndex = 0;
      for (let i = 0, l = lines.length; i < l; i++) {
        lineToIndex[i] = prevIndex;
        prevIndex += lines[i].length + 1;
      }
      input[lineToIndexCache] = lineToIndex;
      return lineToIndex;
    }
    var Input2 = class {
      get from() {
        return this.file || this.id;
      }
      constructor(css, opts = {}) {
        if (css === null || typeof css === "undefined" || typeof css === "object" && !css.toString) {
          throw new Error(`PostCSS received ${css} instead of CSS string`);
        }
        this.css = css.toString();
        if (this.css[0] === "\uFEFF" || this.css[0] === "\uFFFE") {
          this.hasBOM = true;
          this.css = this.css.slice(1);
        } else {
          this.hasBOM = false;
        }
        this.document = this.css;
        if (opts.document) this.document = opts.document.toString();
        if (opts.from) {
          if (!pathAvailable || /^\w+:\/\//.test(opts.from) || isAbsolute(opts.from)) {
            this.file = opts.from;
          } else {
            this.file = resolve(opts.from);
          }
        }
        if (pathAvailable && sourceMapAvailable) {
          let map = new PreviousMap(this.css, opts);
          if (map.text) {
            this.map = map;
            let file = map.consumer().file;
            if (!this.file && file) this.file = this.mapResolve(file);
          }
        }
        if (!this.file) {
          this.id = "<input css " + nanoid(6) + ">";
        }
        if (this.map) this.map.file = this.from;
      }
      error(message, line, column, opts = {}) {
        let endColumn, endLine, endOffset, offset, result;
        if (line && typeof line === "object") {
          let start = line;
          let end = column;
          if (typeof start.offset === "number") {
            offset = start.offset;
            let pos = this.fromOffset(offset);
            line = pos.line;
            column = pos.col;
          } else {
            line = start.line;
            column = start.column;
            offset = this.fromLineAndColumn(line, column);
          }
          if (typeof end.offset === "number") {
            endOffset = end.offset;
            let pos = this.fromOffset(endOffset);
            endLine = pos.line;
            endColumn = pos.col;
          } else {
            endLine = end.line;
            endColumn = end.column;
            endOffset = this.fromLineAndColumn(end.line, end.column);
          }
        } else if (!column) {
          offset = line;
          let pos = this.fromOffset(offset);
          line = pos.line;
          column = pos.col;
        } else {
          offset = this.fromLineAndColumn(line, column);
        }
        let origin = this.origin(line, column, endLine, endColumn);
        if (origin) {
          result = new CssSyntaxError2(
            message,
            origin.endLine === void 0 ? origin.line : { column: origin.column, line: origin.line },
            origin.endLine === void 0 ? origin.column : { column: origin.endColumn, line: origin.endLine },
            origin.source,
            origin.file,
            opts.plugin
          );
        } else {
          result = new CssSyntaxError2(
            message,
            endLine === void 0 ? line : { column, line },
            endLine === void 0 ? column : { column: endColumn, line: endLine },
            this.css,
            this.file,
            opts.plugin
          );
        }
        result.input = {
          column,
          endColumn,
          endLine,
          endOffset,
          line,
          offset,
          source: this.css
        };
        if (this.file) {
          if (pathToFileURL) {
            result.input.url = pathToFileURL(this.file).toString();
          }
          result.input.file = this.file;
        }
        return result;
      }
      fromLineAndColumn(line, column) {
        let lineToIndex = getLineToIndex(this);
        let index = lineToIndex[line - 1];
        return index + column - 1;
      }
      fromOffset(offset) {
        let lineToIndex = getLineToIndex(this);
        let lastLine = lineToIndex[lineToIndex.length - 1];
        let min = 0;
        if (offset >= lastLine) {
          min = lineToIndex.length - 1;
        } else {
          let max = lineToIndex.length - 2;
          let mid;
          while (min < max) {
            mid = min + (max - min >> 1);
            if (offset < lineToIndex[mid]) {
              max = mid - 1;
            } else if (offset >= lineToIndex[mid + 1]) {
              min = mid + 1;
            } else {
              min = mid;
              break;
            }
          }
        }
        return {
          col: offset - lineToIndex[min] + 1,
          line: min + 1
        };
      }
      mapResolve(file) {
        if (/^\w+:\/\//.test(file)) {
          return file;
        }
        return resolve(this.map.consumer().sourceRoot || this.map.root || ".", file);
      }
      origin(line, column, endLine, endColumn) {
        if (!this.map) return false;
        let consumer = this.map.consumer();
        let from = consumer.originalPositionFor({ column: column - 1, line });
        if (!from.source) return false;
        let to;
        if (typeof endLine === "number") {
          let toPosition = consumer.originalPositionFor({
            column: endColumn - 1,
            line: endLine
          });
          if (toPosition.source) to = toPosition;
        }
        let fromUrl;
        if (isAbsolute(from.source)) {
          fromUrl = pathToFileURL(from.source);
        } else {
          fromUrl = new URL(
            from.source,
            this.map.consumer().sourceRoot || pathToFileURL(this.map.mapFile)
          );
        }
        let result = {
          column: from.column + 1,
          endColumn: to && to.column + 1,
          endLine: to && to.line,
          line: from.line,
          url: fromUrl.toString()
        };
        if (fromUrl.protocol === "file:") {
          if (fileURLToPath) {
            result.file = fileURLToPath(fromUrl);
          } else {
            throw new Error(`file: protocol is not available in this PostCSS build`);
          }
        }
        let source = consumer.sourceContentFor(from.source);
        if (source) result.source = source;
        return result;
      }
      toJSON() {
        let json = {};
        for (let name of ["hasBOM", "css", "file", "id"]) {
          if (this[name] != null) {
            json[name] = this[name];
          }
        }
        if (this.map) {
          json.map = { ...this.map };
          if (json.map.consumerCache) {
            json.map.consumerCache = void 0;
          }
        }
        return json;
      }
    };
    module2.exports = Input2;
    Input2.default = Input2;
    if (terminalHighlight && terminalHighlight.registerInput) {
      terminalHighlight.registerInput(Input2);
    }
  }
});

// node_modules/postcss/lib/root.js
var require_root = __commonJS({
  "node_modules/postcss/lib/root.js"(exports, module2) {
    "use strict";
    var Container2 = require_container();
    var LazyResult;
    var Processor2;
    var Root2 = class extends Container2 {
      constructor(defaults) {
        super(defaults);
        this.type = "root";
        if (!this.nodes) this.nodes = [];
      }
      normalize(child, sample, type) {
        let keepBefore = /* @__PURE__ */ new Set();
        for (let node of Array.isArray(child) ? child : [child]) {
          if (node && typeof node === "object" && !node.parent && node.raws && typeof node.raws.before !== "undefined") {
            keepBefore.add(node.raws);
          }
        }
        let nodes = super.normalize(child);
        if (sample) {
          if (type === "prepend") {
            if (this.nodes.length > 1) {
              sample.raws.before = this.nodes[1].raws.before;
            } else {
              delete sample.raws.before;
            }
          } else if (this.first !== sample) {
            for (let node of nodes) {
              if (!keepBefore.has(node.raws)) {
                node.raws.before = sample.raws.before;
              }
            }
          }
        }
        return nodes;
      }
      removeChild(child, ignore) {
        let index = this.index(child);
        if (!ignore && index === 0 && this.nodes.length > 1) {
          this.nodes[1].raws.before = this.nodes[index].raws.before;
        }
        return super.removeChild(child);
      }
      toResult(opts = {}) {
        let lazy = new LazyResult(new Processor2(), this, opts);
        return lazy.stringify();
      }
    };
    Root2.registerLazyResult = (dependant) => {
      LazyResult = dependant;
    };
    Root2.registerProcessor = (dependant) => {
      Processor2 = dependant;
    };
    module2.exports = Root2;
    Root2.default = Root2;
    Container2.registerRoot(Root2);
  }
});

// node_modules/postcss/lib/list.js
var require_list = __commonJS({
  "node_modules/postcss/lib/list.js"(exports, module2) {
    "use strict";
    var list2 = {
      comma(string) {
        return list2.split(string, [","], true);
      },
      space(string) {
        let spaces = [" ", "\n", "	"];
        return list2.split(string, spaces);
      },
      split(string, separators, last) {
        if (typeof string !== "string") return [];
        let array = [];
        let current = "";
        let split = false;
        let func = 0;
        let inQuote = false;
        let prevQuote = "";
        let escape = false;
        let inComment = false;
        for (let i = 0; i < string.length; i++) {
          let letter = string[i];
          if (inComment) {
            current += letter;
            if (letter === "*" && string[i + 1] === "/") {
              current += "/";
              i += 1;
              inComment = false;
            }
            continue;
          }
          if (escape) {
            escape = false;
          } else if (letter === "\\") {
            escape = true;
          } else if (inQuote) {
            if (letter === prevQuote) {
              inQuote = false;
            }
          } else if (letter === '"' || letter === "'") {
            inQuote = true;
            prevQuote = letter;
          } else if (letter === "/" && string[i + 1] === "*") {
            current += "/*";
            i += 1;
            inComment = true;
            continue;
          } else if (letter === "(") {
            func += 1;
          } else if (letter === ")") {
            if (func > 0) func -= 1;
          } else if (func === 0) {
            if (separators.includes(letter)) split = true;
          }
          if (split) {
            let value2 = current.trim();
            if (last || value2 !== "") array.push(value2);
            current = "";
            split = false;
          } else {
            current += letter;
          }
        }
        let value = current.trim();
        if (last || value !== "") array.push(value);
        return array;
      }
    };
    module2.exports = list2;
    list2.default = list2;
  }
});

// node_modules/postcss/lib/rule.js
var require_rule = __commonJS({
  "node_modules/postcss/lib/rule.js"(exports, module2) {
    "use strict";
    var Container2 = require_container();
    var list2 = require_list();
    var Rule2 = class extends Container2 {
      get selectors() {
        return list2.comma(this.selector);
      }
      set selectors(values) {
        let match = this.selector ? this.selector.match(/,\s*/) : null;
        let sep = match ? match[0] : "," + this.raw("between", "beforeOpen");
        this.selector = values.join(sep);
      }
      constructor(defaults) {
        super(defaults);
        this.type = "rule";
        if (!this.nodes) this.nodes = [];
      }
    };
    module2.exports = Rule2;
    Rule2.default = Rule2;
    Container2.registerRule(Rule2);
  }
});

// node_modules/postcss/lib/fromJSON.js
var require_fromJSON = __commonJS({
  "node_modules/postcss/lib/fromJSON.js"(exports, module2) {
    "use strict";
    var AtRule2 = require_at_rule();
    var Comment2 = require_comment();
    var Declaration2 = require_declaration();
    var Input2 = require_input();
    var PreviousMap = require_previous_map();
    var Root2 = require_root();
    var Rule2 = require_rule();
    function hydrateInputs(json, inputs) {
      if (!json.inputs) return inputs;
      return json.inputs.map((input) => {
        let inputHydrated = { ...input, __proto__: Input2.prototype };
        if (inputHydrated.map) {
          inputHydrated.map = {
            ...inputHydrated.map,
            __proto__: PreviousMap.prototype
          };
        }
        return inputHydrated;
      });
    }
    function constructNode(json, inputs, children) {
      let defaults = { ...json };
      delete defaults.inputs;
      delete defaults.nodes;
      if (defaults.source) {
        let { inputId, ...source } = defaults.source;
        defaults.source = source;
        if (inputId != null) {
          defaults.source.input = inputs[inputId];
        }
      }
      let node;
      if (defaults.type === "root") {
        node = new Root2(defaults);
      } else if (defaults.type === "decl") {
        node = new Declaration2(defaults);
      } else if (defaults.type === "rule") {
        node = new Rule2(defaults);
      } else if (defaults.type === "comment") {
        node = new Comment2(defaults);
      } else if (defaults.type === "atrule") {
        node = new AtRule2(defaults);
      } else {
        throw new Error("Unknown node type: " + json.type);
      }
      if (children) {
        node.nodes = children;
        for (let child of children) child.parent = node;
      }
      return node;
    }
    function fromJSON2(json, inputs) {
      if (Array.isArray(json)) return json.map((n) => fromJSON2(n));
      let result;
      let stack = [
        { childIndex: 0, children: [], inputs: hydrateInputs(json, inputs), json }
      ];
      while (stack.length > 0) {
        let frame = stack[stack.length - 1];
        let jsonNodes = frame.json.nodes;
        if (jsonNodes && frame.childIndex < jsonNodes.length) {
          let childJson = jsonNodes[frame.childIndex];
          frame.childIndex += 1;
          stack.push({
            childIndex: 0,
            children: [],
            inputs: hydrateInputs(childJson, frame.inputs),
            json: childJson
          });
          continue;
        }
        stack.pop();
        let node = constructNode(
          frame.json,
          frame.inputs,
          jsonNodes ? frame.children : void 0
        );
        if (stack.length > 0) {
          stack[stack.length - 1].children.push(node);
        } else {
          result = node;
        }
      }
      return result;
    }
    module2.exports = fromJSON2;
    fromJSON2.default = fromJSON2;
  }
});

// node_modules/postcss/lib/map-generator.js
var require_map_generator = __commonJS({
  "node_modules/postcss/lib/map-generator.js"(exports, module2) {
    "use strict";
    var { dirname, relative, resolve, sep } = require_path();
    var { SourceMapConsumer, SourceMapGenerator } = require_source_map();
    var { pathToFileURL } = require_url();
    var Input2 = require_input();
    var sourceMapAvailable = Boolean(SourceMapConsumer && SourceMapGenerator);
    var pathAvailable = Boolean(dirname && resolve && relative && sep);
    var MapGenerator = class {
      constructor(stringify2, root2, opts, cssString) {
        this.stringify = stringify2;
        this.mapOpts = opts.map || {};
        this.root = root2;
        this.opts = opts;
        this.css = cssString;
        this.originalCSS = cssString;
        this.usesFileUrls = !this.mapOpts.from && this.mapOpts.absolute;
        this.memoizedFileURLs = /* @__PURE__ */ new Map();
        this.memoizedPaths = /* @__PURE__ */ new Map();
        this.memoizedURLs = /* @__PURE__ */ new Map();
      }
      addAnnotation() {
        let content;
        if (this.isInline()) {
          content = "data:application/json;base64," + this.toBase64(this.map.toString());
        } else if (typeof this.mapOpts.annotation === "string") {
          content = this.mapOpts.annotation;
        } else if (typeof this.mapOpts.annotation === "function") {
          content = this.mapOpts.annotation(this.opts.to, this.root);
        } else {
          content = this.outputFile() + ".map";
        }
        let eol = "\n";
        if (this.css.includes("\r\n")) eol = "\r\n";
        this.css += eol + "/*# sourceMappingURL=" + content + " */";
      }
      applyPrevMaps() {
        for (let prev of this.previous()) {
          let from = this.toUrl(this.path(prev.file));
          let root2 = prev.root || dirname(prev.file);
          let map;
          if (this.mapOpts.sourcesContent === false) {
            map = new SourceMapConsumer(prev.text);
            if (map.sourcesContent) {
              map.sourcesContent = null;
            }
          } else {
            map = prev.consumer();
          }
          this.map.applySourceMap(map, from, this.toUrl(this.path(root2)));
        }
      }
      clearAnnotation() {
        if (this.mapOpts.annotation === false) return;
        if (this.root) {
          let node;
          for (let i = this.root.nodes.length - 1; i >= 0; i--) {
            node = this.root.nodes[i];
            if (node.type !== "comment") continue;
            if (node.text.startsWith("# sourceMappingURL=")) {
              this.root.removeChild(i);
            }
          }
        } else if (this.css) {
          let annotation = "/*# sourceMappingURL=";
          let css = "";
          let cursor = 0;
          let startIndex;
          while ((startIndex = this.css.indexOf(annotation, cursor)) !== -1) {
            let endIndex = this.css.indexOf("*/", startIndex + annotation.length);
            if (endIndex === -1) break;
            while (startIndex > cursor && this.css[startIndex - 1] === "\n") {
              startIndex--;
            }
            css += this.css.slice(cursor, startIndex);
            cursor = endIndex + 2;
          }
          if (cursor > 0) this.css = css + this.css.slice(cursor);
        }
      }
      generate() {
        this.clearAnnotation();
        if (pathAvailable && sourceMapAvailable && this.isMap()) {
          return this.generateMap();
        } else {
          let result = "";
          this.stringify(this.root, (i) => {
            result += i;
          });
          return [result];
        }
      }
      generateMap() {
        if (this.root) {
          this.generateString();
        } else if (this.previous().length === 1) {
          let prev = this.previous()[0].consumer();
          prev.file = this.outputFile();
          this.map = SourceMapGenerator.fromSourceMap(prev, {
            ignoreInvalidMapping: true
          });
        } else {
          this.map = new SourceMapGenerator({
            file: this.outputFile(),
            ignoreInvalidMapping: true
          });
          this.map.addMapping({
            generated: { column: 0, line: 1 },
            original: { column: 0, line: 1 },
            source: this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>"
          });
        }
        if (this.isSourcesContent()) this.setSourcesContent();
        if (this.root && this.previous().length > 0) this.applyPrevMaps();
        if (this.isAnnotation()) this.addAnnotation();
        if (this.isInline()) {
          return [this.css];
        } else {
          return [this.css, this.map];
        }
      }
      generateString() {
        this.css = "";
        this.map = new SourceMapGenerator({
          file: this.outputFile(),
          ignoreInvalidMapping: true
        });
        let line = 1;
        let column = 1;
        let noSource = "<no source>";
        let mapping = {
          generated: { column: 0, line: 0 },
          original: { column: 0, line: 0 },
          source: ""
        };
        let last, lines;
        this.stringify(this.root, (str, node, type) => {
          this.css += str;
          if (node && type !== "end") {
            mapping.generated.line = line;
            mapping.generated.column = column - 1;
            if (node.source && node.source.start) {
              mapping.source = this.sourcePath(node);
              mapping.original.line = node.source.start.line;
              mapping.original.column = node.source.start.column - 1;
              this.map.addMapping(mapping);
            } else {
              mapping.source = noSource;
              mapping.original.line = 1;
              mapping.original.column = 0;
              this.map.addMapping(mapping);
            }
          }
          lines = str.match(/\n/g);
          if (lines) {
            line += lines.length;
            last = str.lastIndexOf("\n");
            column = str.length - last;
          } else {
            column += str.length;
          }
          if (node && type !== "start") {
            let p = node.parent || { raws: {} };
            let childless = node.type === "decl" || node.type === "atrule" && !node.nodes;
            if (!childless || node !== p.last || p.raws.semicolon) {
              if (node.source && node.source.end) {
                mapping.source = this.sourcePath(node);
                mapping.original.line = node.source.end.line;
                mapping.original.column = node.source.end.column - 1;
                mapping.generated.line = line;
                mapping.generated.column = column - 2;
                this.map.addMapping(mapping);
              } else {
                mapping.source = noSource;
                mapping.original.line = 1;
                mapping.original.column = 0;
                mapping.generated.line = line;
                mapping.generated.column = column - 1;
                this.map.addMapping(mapping);
              }
            }
          }
        });
      }
      isAnnotation() {
        if (this.isInline()) {
          return true;
        }
        if (typeof this.mapOpts.annotation !== "undefined") {
          return this.mapOpts.annotation;
        }
        if (this.previous().length) {
          return this.previous().some((i) => i.annotation);
        }
        return true;
      }
      isInline() {
        if (typeof this.mapOpts.inline !== "undefined") {
          return this.mapOpts.inline;
        }
        let annotation = this.mapOpts.annotation;
        if (typeof annotation !== "undefined" && annotation !== true) {
          return false;
        }
        if (this.previous().length) {
          return this.previous().some((i) => i.inline);
        }
        return true;
      }
      isMap() {
        if (typeof this.opts.map !== "undefined") {
          return !!this.opts.map;
        }
        return this.previous().length > 0;
      }
      isSourcesContent() {
        if (typeof this.mapOpts.sourcesContent !== "undefined") {
          return this.mapOpts.sourcesContent;
        }
        if (this.previous().length) {
          return this.previous().some((i) => i.withContent());
        }
        return true;
      }
      outputFile() {
        if (this.opts.to) {
          return this.path(this.opts.to);
        } else if (this.opts.from) {
          return this.path(this.opts.from);
        } else {
          return "to.css";
        }
      }
      path(file) {
        if (this.mapOpts.absolute) return file;
        if (file.charCodeAt(0) === 60) return file;
        if (/^\w+:\/\//.test(file)) return file;
        let cached = this.memoizedPaths.get(file);
        if (cached) return cached;
        let from = this.opts.to ? dirname(this.opts.to) : ".";
        if (typeof this.mapOpts.annotation === "string") {
          from = dirname(resolve(from, this.mapOpts.annotation));
        }
        let path = relative(from, file);
        this.memoizedPaths.set(file, path);
        return path;
      }
      previous() {
        if (!this.previousMaps) {
          this.previousMaps = [];
          if (this.root) {
            this.root.walk((node) => {
              if (node.source && node.source.input.map) {
                let map = node.source.input.map;
                if (!this.previousMaps.includes(map)) {
                  this.previousMaps.push(map);
                }
              }
            });
          } else {
            let input = new Input2(this.originalCSS, this.opts);
            if (input.map) this.previousMaps.push(input.map);
          }
        }
        return this.previousMaps;
      }
      setSourcesContent() {
        let already = {};
        if (this.root) {
          this.root.walk((node) => {
            if (node.source) {
              let from = node.source.input.from;
              if (from && !already[from]) {
                already[from] = true;
                let fromUrl = this.usesFileUrls ? this.toFileUrl(from) : this.toUrl(this.path(from));
                this.map.setSourceContent(fromUrl, node.source.input.css);
              }
            }
          });
        } else if (this.css) {
          let from = this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>";
          this.map.setSourceContent(from, this.css);
        }
      }
      sourcePath(node) {
        if (this.mapOpts.from) {
          return this.toUrl(this.mapOpts.from);
        } else if (this.usesFileUrls) {
          return this.toFileUrl(node.source.input.from);
        } else {
          return this.toUrl(this.path(node.source.input.from));
        }
      }
      toBase64(str) {
        if (Buffer) {
          return Buffer.from(str).toString("base64");
        } else {
          return window.btoa(unescape(encodeURIComponent(str)));
        }
      }
      toFileUrl(path) {
        let cached = this.memoizedFileURLs.get(path);
        if (cached) return cached;
        if (pathToFileURL) {
          let fileURL = pathToFileURL(path).toString();
          this.memoizedFileURLs.set(path, fileURL);
          return fileURL;
        } else {
          throw new Error(
            "`map.absolute` option is not available in this PostCSS build"
          );
        }
      }
      toUrl(path) {
        let cached = this.memoizedURLs.get(path);
        if (cached) return cached;
        if (sep === "\\") {
          path = path.replace(/\\/g, "/");
        }
        let url = encodeURI(path).replace(/[#?]/g, encodeURIComponent);
        this.memoizedURLs.set(path, url);
        return url;
      }
    };
    module2.exports = MapGenerator;
  }
});

// node_modules/postcss/lib/tokenize.js
var require_tokenize = __commonJS({
  "node_modules/postcss/lib/tokenize.js"(exports, module2) {
    "use strict";
    var SINGLE_QUOTE = "'".charCodeAt(0);
    var DOUBLE_QUOTE = '"'.charCodeAt(0);
    var BACKSLASH = "\\".charCodeAt(0);
    var SLASH = "/".charCodeAt(0);
    var NEWLINE = "\n".charCodeAt(0);
    var SPACE = " ".charCodeAt(0);
    var FEED = "\f".charCodeAt(0);
    var TAB = "	".charCodeAt(0);
    var CR = "\r".charCodeAt(0);
    var OPEN_SQUARE = "[".charCodeAt(0);
    var CLOSE_SQUARE = "]".charCodeAt(0);
    var OPEN_PARENTHESES = "(".charCodeAt(0);
    var CLOSE_PARENTHESES = ")".charCodeAt(0);
    var OPEN_CURLY = "{".charCodeAt(0);
    var CLOSE_CURLY = "}".charCodeAt(0);
    var SEMICOLON = ";".charCodeAt(0);
    var ASTERISK = "*".charCodeAt(0);
    var COLON = ":".charCodeAt(0);
    var AT = "@".charCodeAt(0);
    var RE_AT_END = /[\t\n\f\r "#'()/;[\\\]{}]/g;
    var RE_WORD_END = /[\t\n\f\r !"#'():;@[\\\]{}]|\/(?=\*)/g;
    var RE_BAD_BRACKET = /.[\r\n"'(/\\]/;
    var RE_HEX_ESCAPE = /[\da-f]/i;
    module2.exports = function tokenizer(input, options = {}) {
      let css = input.css.valueOf();
      let ignore = options.ignoreErrors;
      let code, content, escape, next, quote;
      let currentToken, escaped, escapePos, n, prev;
      let length = css.length;
      let pos = 0;
      let buffer = [];
      let returned = [];
      let lastBadParen = -1;
      function position() {
        return pos;
      }
      function unclosed(what) {
        throw input.error("Unclosed " + what, pos);
      }
      function endOfFile() {
        return returned.length === 0 && pos >= length;
      }
      function nextToken(opts) {
        if (returned.length) return returned.pop();
        if (pos >= length) return;
        let ignoreUnclosed = opts ? opts.ignoreUnclosed : false;
        code = css.charCodeAt(pos);
        switch (code) {
          case NEWLINE:
          case SPACE:
          case TAB:
          case CR:
          case FEED: {
            next = pos;
            do {
              next += 1;
              code = css.charCodeAt(next);
            } while (code === SPACE || code === NEWLINE || code === TAB || code === CR || code === FEED);
            currentToken = ["space", css.slice(pos, next)];
            pos = next - 1;
            break;
          }
          case OPEN_SQUARE:
          case CLOSE_SQUARE:
          case OPEN_CURLY:
          case CLOSE_CURLY:
          case COLON:
          case SEMICOLON:
          case CLOSE_PARENTHESES: {
            let controlChar = String.fromCharCode(code);
            currentToken = [controlChar, controlChar, pos];
            break;
          }
          case OPEN_PARENTHESES: {
            prev = buffer.length ? buffer.pop()[1] : "";
            n = css.charCodeAt(pos + 1);
            if (prev === "url" && n !== SINGLE_QUOTE && n !== DOUBLE_QUOTE && n !== SPACE && n !== NEWLINE && n !== TAB && n !== FEED && n !== CR) {
              next = pos;
              do {
                escaped = false;
                next = css.indexOf(")", next + 1);
                if (next === -1) {
                  if (ignore || ignoreUnclosed) {
                    next = pos;
                    break;
                  } else {
                    unclosed("bracket");
                  }
                }
                escapePos = next;
                while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
                  escapePos -= 1;
                  escaped = !escaped;
                }
              } while (escaped);
              currentToken = ["brackets", css.slice(pos, next + 1), pos, next];
              pos = next;
            } else if (pos <= lastBadParen) {
              currentToken = ["(", "(", pos];
            } else {
              next = css.indexOf(")", pos + 1);
              content = css.slice(pos, next + 1);
              if (next === -1 || RE_BAD_BRACKET.test(content)) {
                lastBadParen = next === -1 ? length : next;
                currentToken = ["(", "(", pos];
              } else {
                currentToken = ["brackets", content, pos, next];
                pos = next;
              }
            }
            break;
          }
          case SINGLE_QUOTE:
          case DOUBLE_QUOTE: {
            quote = code === SINGLE_QUOTE ? "'" : '"';
            next = pos;
            do {
              escaped = false;
              next = css.indexOf(quote, next + 1);
              if (next === -1) {
                if (ignore || ignoreUnclosed) {
                  next = pos + 1;
                  break;
                } else {
                  unclosed("string");
                }
              }
              escapePos = next;
              while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
                escapePos -= 1;
                escaped = !escaped;
              }
            } while (escaped);
            currentToken = ["string", css.slice(pos, next + 1), pos, next];
            pos = next;
            break;
          }
          case AT: {
            RE_AT_END.lastIndex = pos + 1;
            RE_AT_END.test(css);
            if (RE_AT_END.lastIndex === 0) {
              next = css.length - 1;
            } else {
              next = RE_AT_END.lastIndex - 2;
            }
            currentToken = ["at-word", css.slice(pos, next + 1), pos, next];
            pos = next;
            break;
          }
          case BACKSLASH: {
            next = pos;
            escape = true;
            while (css.charCodeAt(next + 1) === BACKSLASH) {
              next += 1;
              escape = !escape;
            }
            code = css.charCodeAt(next + 1);
            if (escape && code !== SLASH && code !== SPACE && code !== NEWLINE && code !== TAB && code !== CR && code !== FEED) {
              next += 1;
              if (RE_HEX_ESCAPE.test(css.charAt(next))) {
                while (RE_HEX_ESCAPE.test(css.charAt(next + 1))) {
                  next += 1;
                }
                if (css.charCodeAt(next + 1) === SPACE) {
                  next += 1;
                }
              }
            }
            currentToken = ["word", css.slice(pos, next + 1), pos, next];
            pos = next;
            break;
          }
          default: {
            if (code === SLASH && css.charCodeAt(pos + 1) === ASTERISK) {
              next = css.indexOf("*/", pos + 2) + 1;
              if (next === 0) {
                if (ignore || ignoreUnclosed) {
                  next = css.length;
                } else {
                  unclosed("comment");
                }
              }
              currentToken = ["comment", css.slice(pos, next + 1), pos, next];
              pos = next;
            } else {
              RE_WORD_END.lastIndex = pos + 1;
              RE_WORD_END.test(css);
              if (RE_WORD_END.lastIndex === 0) {
                next = css.length - 1;
              } else {
                next = RE_WORD_END.lastIndex - 2;
              }
              currentToken = ["word", css.slice(pos, next + 1), pos, next];
              buffer.push(currentToken);
              pos = next;
            }
            break;
          }
        }
        pos++;
        return currentToken;
      }
      function back(token) {
        returned.push(token);
      }
      return {
        back,
        endOfFile,
        nextToken,
        position
      };
    };
  }
});

// node_modules/postcss/lib/parser.js
var require_parser = __commonJS({
  "node_modules/postcss/lib/parser.js"(exports, module2) {
    "use strict";
    var AtRule2 = require_at_rule();
    var Comment2 = require_comment();
    var Declaration2 = require_declaration();
    var Root2 = require_root();
    var Rule2 = require_rule();
    var tokenizer = require_tokenize();
    var SAFE_COMMENT_NEIGHBOR = {
      empty: true,
      space: true
    };
    function findLastWithPosition(tokens) {
      for (let i = tokens.length - 1; i >= 0; i--) {
        let token = tokens[i];
        let pos = token[3] || token[2];
        if (pos) return pos;
      }
    }
    function tokensToString(tokens, from, to) {
      let result = "";
      for (let i = from; i < to; i++) result += tokens[i][1];
      return result;
    }
    var Parser = class {
      constructor(input) {
        this.input = input;
        this.root = new Root2();
        this.current = this.root;
        this.spaces = "";
        this.semicolon = false;
        this.createTokenizer();
        this.root.source = { input, start: { column: 1, line: 1, offset: 0 } };
      }
      atrule(token) {
        let node = new AtRule2();
        node.name = token[1].slice(1);
        if (node.name === "") {
          this.unnamedAtrule(node, token);
        }
        this.init(node, token[2]);
        let type;
        let prev;
        let shift;
        let last = false;
        let open = false;
        let params = [];
        let brackets = [];
        while (!this.tokenizer.endOfFile()) {
          token = this.tokenizer.nextToken();
          type = token[0];
          if (type === "(" || type === "[") {
            brackets.push(type === "(" ? ")" : "]");
          } else if (type === "{" && brackets.length > 0) {
            brackets.push("}");
          } else if (type === brackets[brackets.length - 1]) {
            brackets.pop();
          }
          if (brackets.length === 0) {
            if (type === ";") {
              node.source.end = this.getPosition(token[2]);
              node.source.end.offset++;
              this.semicolon = true;
              break;
            } else if (type === "{") {
              open = true;
              break;
            } else if (type === "}") {
              if (params.length > 0) {
                shift = params.length - 1;
                prev = params[shift];
                while (prev && prev[0] === "space") {
                  prev = params[--shift];
                }
                if (prev) {
                  node.source.end = this.getPosition(prev[3] || prev[2]);
                  node.source.end.offset++;
                }
              }
              this.end(token);
              break;
            } else {
              params.push(token);
            }
          } else {
            params.push(token);
          }
          if (this.tokenizer.endOfFile()) {
            last = true;
            break;
          }
        }
        node.raws.between = this.spacesAndCommentsFromEnd(params);
        if (params.length) {
          node.raws.afterName = this.spacesAndCommentsFromStart(params);
          this.raw(node, "params", params);
          if (last) {
            token = params[params.length - 1];
            node.source.end = this.getPosition(token[3] || token[2]);
            node.source.end.offset++;
            this.spaces = node.raws.between;
            node.raws.between = "";
          }
        } else {
          node.raws.afterName = "";
          node.params = "";
        }
        if (open) {
          node.nodes = [];
          this.current = node;
        }
      }
      checkMissedSemicolon(tokens) {
        let colon = this.colon(tokens);
        if (colon === false) return;
        let founded = 0;
        let token;
        for (let j = colon - 1; j >= 0; j--) {
          token = tokens[j];
          if (token[0] !== "space") {
            founded += 1;
            if (founded === 2) break;
          }
        }
        throw this.input.error(
          "Missed semicolon",
          token[0] === "word" ? token[3] + 1 : token[2]
        );
      }
      colon(tokens) {
        let brackets = 0;
        let prev, token, type;
        for (let [i, element] of tokens.entries()) {
          token = element;
          type = token[0];
          if (type === "(") {
            brackets += 1;
          }
          if (type === ")") {
            brackets -= 1;
          }
          if (brackets === 0 && type === ":") {
            if (!prev) {
              this.doubleColon(token);
            } else if (prev[0] === "word" && prev[1] === "progid") {
              continue;
            } else {
              return i;
            }
          }
          prev = token;
        }
        return false;
      }
      comment(token) {
        let node = new Comment2();
        this.init(node, token[2]);
        node.source.end = this.getPosition(token[3] || token[2]);
        node.source.end.offset++;
        let text = token[1].slice(2, -2);
        if (!text.trim()) {
          node.text = "";
          node.raws.left = text;
          node.raws.right = "";
        } else {
          let match = text.match(/^(\s*)([^]*\S)(\s*)$/);
          node.text = match[2];
          node.raws.left = match[1];
          node.raws.right = match[3];
        }
      }
      createTokenizer() {
        this.tokenizer = tokenizer(this.input);
      }
      decl(tokens, customProperty) {
        let node = new Declaration2();
        this.init(node, tokens[0][2]);
        let last = tokens[tokens.length - 1];
        if (last[0] === ";") {
          this.semicolon = true;
          tokens.pop();
        }
        node.source.end = this.getPosition(
          last[3] || last[2] || findLastWithPosition(tokens)
        );
        node.source.end.offset++;
        let start = 0;
        while (tokens[start][0] !== "word") {
          if (start === tokens.length - 1) this.unknownWord([tokens[start]]);
          start++;
        }
        node.raws.before += tokensToString(tokens, 0, start);
        node.source.start = this.getPosition(tokens[start][2]);
        let propStart = start;
        while (start < tokens.length) {
          let type = tokens[start][0];
          if (type === ":" || type === "space" || type === "comment") {
            break;
          }
          start++;
        }
        node.prop = tokensToString(tokens, propStart, start);
        let betweenStart = start;
        let token;
        while (start < tokens.length) {
          token = tokens[start];
          start++;
          if (token[0] === ":") break;
          if (token[0] === "word" && /\w/.test(token[1])) {
            this.unknownWord([token]);
          }
        }
        node.raws.between = tokensToString(tokens, betweenStart, start);
        if (node.prop[0] === "_" || node.prop[0] === "*") {
          node.raws.before += node.prop[0];
          node.prop = node.prop.slice(1);
        }
        let firstSpacesStart = start;
        while (start < tokens.length) {
          let next = tokens[start][0];
          if (next !== "space" && next !== "comment") break;
          start++;
        }
        let firstSpaces = tokens.slice(firstSpacesStart, start);
        tokens = tokens.slice(start);
        this.precheckMissedSemicolon(tokens);
        for (let i = tokens.length - 1; i >= 0; i--) {
          token = tokens[i];
          if (token[1].toLowerCase() === "!important") {
            node.important = true;
            let string = this.stringFrom(tokens, i);
            string = this.spacesFromEnd(tokens) + string;
            if (string !== " !important") node.raws.important = string;
            break;
          } else if (token[1].toLowerCase() === "important") {
            let cache = tokens.slice(0);
            let str = "";
            for (let j = i; j > 0; j--) {
              let type = cache[j][0];
              if (str.trim().startsWith("!") && type !== "space") {
                break;
              }
              str = cache.pop()[1] + str;
            }
            if (str.trim().startsWith("!")) {
              node.important = true;
              node.raws.important = str;
              tokens = cache;
            }
          }
          if (token[0] !== "space" && token[0] !== "comment") {
            break;
          }
        }
        let hasWord = tokens.some((i) => i[0] !== "space" && i[0] !== "comment");
        if (hasWord) {
          node.raws.between += firstSpaces.map((i) => i[1]).join("");
          firstSpaces = [];
        }
        this.raw(node, "value", firstSpaces.concat(tokens), customProperty);
        if (node.value.includes(":") && !customProperty) {
          this.checkMissedSemicolon(tokens);
        }
      }
      doubleColon(token) {
        throw this.input.error(
          "Double colon",
          { offset: token[2] },
          { offset: token[2] + token[1].length }
        );
      }
      emptyRule(token) {
        let node = new Rule2();
        this.init(node, token[2]);
        node.selector = "";
        node.raws.between = "";
        this.current = node;
      }
      end(token) {
        if (this.current.nodes && this.current.nodes.length) {
          this.current.raws.semicolon = this.semicolon;
        }
        this.semicolon = false;
        this.current.raws.after = (this.current.raws.after || "") + this.spaces;
        this.spaces = "";
        if (this.current.parent) {
          this.current.source.end = this.getPosition(token[2]);
          this.current.source.end.offset++;
          this.current = this.current.parent;
        } else {
          this.unexpectedClose(token);
        }
      }
      endFile() {
        if (this.current.parent) this.unclosedBlock();
        if (this.current.nodes && this.current.nodes.length) {
          this.current.raws.semicolon = this.semicolon;
        }
        this.current.raws.after = (this.current.raws.after || "") + this.spaces;
        this.root.source.end = this.getPosition(this.tokenizer.position());
      }
      freeSemicolon(token) {
        this.spaces += token[1];
        if (this.current.nodes) {
          let prev = this.current.nodes[this.current.nodes.length - 1];
          if (prev && prev.type === "rule" && !prev.raws.ownSemicolon) {
            prev.raws.ownSemicolon = this.spaces;
            this.spaces = "";
            prev.source.end = this.getPosition(token[2]);
            prev.source.end.offset++;
          }
        }
      }
      // Helpers
      getPosition(offset) {
        let pos = this.input.fromOffset(offset);
        return {
          column: pos.col,
          line: pos.line,
          offset
        };
      }
      init(node, offset) {
        this.current.push(node);
        node.source = {
          input: this.input,
          start: this.getPosition(offset)
        };
        node.raws.before = this.spaces;
        this.spaces = "";
        if (node.type !== "comment") this.semicolon = false;
      }
      other(start) {
        let end = false;
        let type = null;
        let colon = false;
        let bracket = null;
        let brackets = [];
        let customProperty = start[1].startsWith("--");
        let tokens = [];
        let token = start;
        while (token) {
          type = token[0];
          tokens.push(token);
          if (type === "(" || type === "[") {
            if (!bracket) bracket = token;
            brackets.push(type === "(" ? ")" : "]");
          } else if (customProperty && colon && type === "{") {
            if (!bracket) bracket = token;
            brackets.push("}");
          } else if (brackets.length === 0) {
            if (type === ";") {
              if (colon) {
                this.decl(tokens, customProperty);
                return;
              } else {
                break;
              }
            } else if (type === "{") {
              this.rule(tokens);
              return;
            } else if (type === "}") {
              this.tokenizer.back(tokens.pop());
              end = true;
              break;
            } else if (type === ":") {
              colon = true;
            }
          } else if (type === brackets[brackets.length - 1]) {
            brackets.pop();
            if (brackets.length === 0) bracket = null;
          }
          token = this.tokenizer.nextToken();
        }
        if (this.tokenizer.endOfFile()) end = true;
        if (brackets.length > 0) this.unclosedBracket(bracket);
        if (end && colon) {
          if (!customProperty) {
            while (tokens.length) {
              token = tokens[tokens.length - 1][0];
              if (token !== "space" && token !== "comment") break;
              this.tokenizer.back(tokens.pop());
            }
          }
          this.decl(tokens, customProperty);
        } else {
          this.unknownWord(tokens);
        }
      }
      parse() {
        let token;
        while (!this.tokenizer.endOfFile()) {
          token = this.tokenizer.nextToken();
          switch (token[0]) {
            case "space":
              this.spaces += token[1];
              break;
            case ";":
              this.freeSemicolon(token);
              break;
            case "}":
              this.end(token);
              break;
            case "comment":
              this.comment(token);
              break;
            case "at-word":
              this.atrule(token);
              break;
            case "{":
              this.emptyRule(token);
              break;
            default:
              this.other(token);
              break;
          }
        }
        this.endFile();
      }
      precheckMissedSemicolon() {
      }
      raw(node, prop, tokens, customProperty) {
        let token, type;
        let length = tokens.length;
        let value = "";
        let last = "";
        let clean = true;
        let next, prev;
        for (let i = 0; i < length; i += 1) {
          token = tokens[i];
          type = token[0];
          if (type === "space" && i === length - 1 && !customProperty) {
            clean = false;
          } else if (type === "comment") {
            prev = tokens[i - 1] ? tokens[i - 1][0] : "empty";
            next = tokens[i + 1] ? tokens[i + 1][0] : "empty";
            if (!SAFE_COMMENT_NEIGHBOR[prev] && !SAFE_COMMENT_NEIGHBOR[next]) {
              if (last === ",") {
                clean = false;
              } else {
                value += token[1];
                last = token[1].slice(-1);
              }
            } else {
              clean = false;
            }
          } else {
            value += token[1];
            last = token[1].slice(-1);
          }
        }
        if (!clean) {
          let raw = tokens.reduce((all, i) => all + i[1], "");
          node.raws[prop] = { raw, value };
        }
        node[prop] = value;
      }
      rule(tokens) {
        tokens.pop();
        let node = new Rule2();
        this.init(node, tokens[0][2]);
        node.raws.between = this.spacesAndCommentsFromEnd(tokens);
        this.raw(node, "selector", tokens);
        this.current = node;
      }
      spacesAndCommentsFromEnd(tokens) {
        let lastTokenType;
        let spaces = "";
        while (tokens.length) {
          lastTokenType = tokens[tokens.length - 1][0];
          if (lastTokenType !== "space" && lastTokenType !== "comment") break;
          spaces = tokens.pop()[1] + spaces;
        }
        return spaces;
      }
      // Errors
      spacesAndCommentsFromStart(tokens) {
        let next;
        let spaces = "";
        while (tokens.length) {
          next = tokens[0][0];
          if (next !== "space" && next !== "comment") break;
          spaces += tokens.shift()[1];
        }
        return spaces;
      }
      spacesFromEnd(tokens) {
        let lastTokenType;
        let spaces = "";
        while (tokens.length) {
          lastTokenType = tokens[tokens.length - 1][0];
          if (lastTokenType !== "space") break;
          spaces = tokens.pop()[1] + spaces;
        }
        return spaces;
      }
      stringFrom(tokens, from) {
        let result = "";
        for (let i = from; i < tokens.length; i++) {
          result += tokens[i][1];
        }
        tokens.splice(from, tokens.length - from);
        return result;
      }
      unclosedBlock() {
        let pos = this.current.source.start;
        throw this.input.error("Unclosed block", pos.line, pos.column);
      }
      unclosedBracket(bracket) {
        throw this.input.error(
          "Unclosed bracket",
          { offset: bracket[2] },
          { offset: bracket[2] + 1 }
        );
      }
      unexpectedClose(token) {
        throw this.input.error(
          "Unexpected }",
          { offset: token[2] },
          { offset: token[2] + 1 }
        );
      }
      unknownWord(tokens) {
        throw this.input.error(
          "Unknown word " + tokens[0][1],
          { offset: tokens[0][2] },
          { offset: tokens[0][2] + tokens[0][1].length }
        );
      }
      unnamedAtrule(node, token) {
        throw this.input.error(
          "At-rule without name",
          { offset: token[2] },
          { offset: token[2] + token[1].length }
        );
      }
    };
    module2.exports = Parser;
  }
});

// node_modules/postcss/lib/parse.js
var require_parse = __commonJS({
  "node_modules/postcss/lib/parse.js"(exports, module2) {
    "use strict";
    var Container2 = require_container();
    var Input2 = require_input();
    var Parser = require_parser();
    function parse2(css, opts) {
      let input = new Input2(css, opts);
      let parser = new Parser(input);
      try {
        parser.parse();
      } catch (e) {
        if (true) {
          if (e.name === "CssSyntaxError" && opts && opts.from) {
            if (/\.scss$/i.test(opts.from)) {
              e.message += "\nYou tried to parse SCSS with the standard CSS parser; try again with the postcss-scss parser";
            } else if (/\.sass/i.test(opts.from)) {
              e.message += "\nYou tried to parse Sass with the standard CSS parser; try again with the postcss-sass parser";
            } else if (/\.less$/i.test(opts.from)) {
              e.message += "\nYou tried to parse Less with the standard CSS parser; try again with the postcss-less parser";
            }
          }
        }
        throw e;
      }
      return parser.root;
    }
    module2.exports = parse2;
    parse2.default = parse2;
    Container2.registerParse(parse2);
  }
});

// node_modules/postcss/lib/warning.js
var require_warning = __commonJS({
  "node_modules/postcss/lib/warning.js"(exports, module2) {
    "use strict";
    var Container2 = require_container();
    var { my } = require_symbols();
    var Warning2 = class {
      constructor(text, opts = {}) {
        this.type = "warning";
        this.text = text;
        if (opts.node && opts.node.source) {
          if (!opts.node[my]) {
            Container2.rebuild(opts.node);
          }
          let range = opts.node.rangeBy(opts);
          this.line = range.start.line;
          this.column = range.start.column;
          this.endLine = range.end.line;
          this.endColumn = range.end.column;
        }
        for (let opt in opts) this[opt] = opts[opt];
      }
      toString() {
        if (this.node) {
          return this.node.error(this.text, {
            index: this.index,
            plugin: this.plugin,
            word: this.word
          }).message;
        }
        if (this.plugin) {
          return this.plugin + ": " + this.text;
        }
        return this.text;
      }
    };
    module2.exports = Warning2;
    Warning2.default = Warning2;
  }
});

// node_modules/postcss/lib/result.js
var require_result = __commonJS({
  "node_modules/postcss/lib/result.js"(exports, module2) {
    "use strict";
    var Warning2 = require_warning();
    var Result2 = class {
      get content() {
        return this.css;
      }
      constructor(processor, root2, opts) {
        this.processor = processor;
        this.messages = [];
        this.root = root2;
        this.opts = opts;
        this.css = "";
        this.map = void 0;
      }
      toString() {
        return this.css;
      }
      warn(text, opts = {}) {
        if (!opts.plugin) {
          if (this.lastPlugin && this.lastPlugin.postcssPlugin) {
            opts.plugin = this.lastPlugin.postcssPlugin;
          }
        }
        let warning = new Warning2(text, opts);
        this.messages.push(warning);
        return warning;
      }
      warnings() {
        return this.messages.filter((i) => i.type === "warning");
      }
    };
    module2.exports = Result2;
    Result2.default = Result2;
  }
});

// node_modules/postcss/lib/warn-once.js
var require_warn_once = __commonJS({
  "node_modules/postcss/lib/warn-once.js"(exports, module2) {
    "use strict";
    var printed = {};
    module2.exports = function warnOnce(message) {
      if (printed[message]) return;
      printed[message] = true;
      if (typeof console !== "undefined" && console.warn) {
        console.warn(message);
      }
    };
  }
});

// node_modules/postcss/lib/lazy-result.js
var require_lazy_result = __commonJS({
  "node_modules/postcss/lib/lazy-result.js"(exports, module2) {
    "use strict";
    var Container2 = require_container();
    var Document2 = require_document();
    var MapGenerator = require_map_generator();
    var parse2 = require_parse();
    var Result2 = require_result();
    var Root2 = require_root();
    var stringify2 = require_stringify();
    var { isClean, my } = require_symbols();
    var warnOnce = require_warn_once();
    var TYPE_TO_CLASS_NAME = {
      atrule: "AtRule",
      comment: "Comment",
      decl: "Declaration",
      document: "Document",
      root: "Root",
      rule: "Rule"
    };
    var PLUGIN_PROPS = {
      AtRule: true,
      AtRuleExit: true,
      Comment: true,
      CommentExit: true,
      Declaration: true,
      DeclarationExit: true,
      Document: true,
      DocumentExit: true,
      Once: true,
      OnceExit: true,
      postcssPlugin: true,
      prepare: true,
      Root: true,
      RootExit: true,
      Rule: true,
      RuleExit: true
    };
    var NOT_VISITORS = {
      Once: true,
      postcssPlugin: true,
      prepare: true
    };
    var CHILDREN = 0;
    function isPromise(obj) {
      return typeof obj === "object" && typeof obj.then === "function";
    }
    function getEvents(node) {
      let key = false;
      let type = TYPE_TO_CLASS_NAME[node.type];
      if (node.type === "decl") {
        key = node.prop.toLowerCase();
      } else if (node.type === "atrule") {
        key = node.name.toLowerCase();
      }
      if (key && node.append) {
        return [
          type,
          type + "-" + key,
          CHILDREN,
          type + "Exit",
          type + "Exit-" + key
        ];
      } else if (key) {
        return [type, type + "-" + key, type + "Exit", type + "Exit-" + key];
      } else if (node.append) {
        return [type, CHILDREN, type + "Exit"];
      } else {
        return [type, type + "Exit"];
      }
    }
    function toStack(node) {
      let events;
      if (node.type === "document") {
        events = ["Document", CHILDREN, "DocumentExit"];
      } else if (node.type === "root") {
        events = ["Root", CHILDREN, "RootExit"];
      } else {
        events = getEvents(node);
      }
      return {
        eventIndex: 0,
        events,
        iterator: 0,
        node,
        visitorIndex: 0,
        visitors: []
      };
    }
    function cleanMarks(node) {
      let stack = [node];
      while (stack.length > 0) {
        let next = stack.pop();
        next[isClean] = false;
        if (next.nodes) {
          for (let i of next.nodes) stack.push(i);
        }
      }
      return node;
    }
    var postcss2 = {};
    var LazyResult = class _LazyResult {
      get content() {
        return this.stringify().content;
      }
      get css() {
        return this.stringify().css;
      }
      get map() {
        return this.stringify().map;
      }
      get messages() {
        return this.sync().messages;
      }
      get opts() {
        return this.result.opts;
      }
      get processor() {
        return this.result.processor;
      }
      get root() {
        return this.sync().root;
      }
      get [Symbol.toStringTag]() {
        return "LazyResult";
      }
      constructor(processor, css, opts) {
        this.stringified = false;
        this.processed = false;
        let root2;
        if (typeof css === "object" && css !== null && (css.type === "root" || css.type === "document")) {
          root2 = cleanMarks(css);
        } else if (css instanceof _LazyResult || css instanceof Result2) {
          root2 = cleanMarks(css.root);
          if (css.map) {
            if (typeof opts.map === "undefined") opts.map = {};
            if (!opts.map.inline) opts.map.inline = false;
            opts.map.prev = css.map;
          }
        } else {
          let parser = parse2;
          if (opts.syntax) parser = opts.syntax.parse;
          if (opts.parser) parser = opts.parser;
          if (parser.parse) parser = parser.parse;
          try {
            root2 = parser(css, opts);
          } catch (error) {
            this.processed = true;
            this.error = error;
          }
          if (root2 && !root2[my]) {
            Container2.rebuild(root2);
          }
        }
        this.result = new Result2(processor, root2, opts);
        this.helpers = { ...postcss2, postcss: postcss2, result: this.result };
        this.plugins = this.processor.plugins.map((plugin2) => {
          if (typeof plugin2 === "object" && plugin2.prepare) {
            return { ...plugin2, ...plugin2.prepare(this.result) };
          } else {
            return plugin2;
          }
        });
      }
      async() {
        if (this.error) return Promise.reject(this.error);
        if (this.processed) return Promise.resolve(this.result);
        if (!this.processing) {
          this.processing = this.runAsync();
        }
        return this.processing;
      }
      catch(onRejected) {
        return this.async().catch(onRejected);
      }
      finally(onFinally) {
        return this.async().then(onFinally, onFinally);
      }
      getAsyncError() {
        throw new Error("Use process(css).then(cb) to work with async plugins");
      }
      handleError(error, node) {
        let plugin2 = this.result.lastPlugin;
        try {
          if (node) node.addToError(error);
          this.error = error;
          if (error.name === "CssSyntaxError" && !error.plugin) {
            error.plugin = plugin2.postcssPlugin;
            error.setMessage();
          } else if (plugin2.postcssVersion) {
            if (true) {
              let pluginName = plugin2.postcssPlugin;
              let pluginVer = plugin2.postcssVersion;
              let runtimeVer = this.result.processor.version;
              let a = pluginVer.split(".");
              let b = runtimeVer.split(".");
              if (a[0] !== b[0] || parseInt(a[1]) > parseInt(b[1])) {
                console.error(
                  "Unknown error from PostCSS plugin. Your current PostCSS version is " + runtimeVer + ", but " + pluginName + " uses " + pluginVer + ". Perhaps this is the source of the error below."
                );
              }
            }
          }
        } catch (err) {
          if (console && console.error) console.error(err);
        }
        return error;
      }
      prepareVisitors() {
        this.listeners = {};
        let add = (plugin2, type, cb) => {
          if (!this.listeners[type]) this.listeners[type] = [];
          this.listeners[type].push([plugin2, cb]);
        };
        for (let plugin2 of this.plugins) {
          if (typeof plugin2 === "object") {
            for (let event in plugin2) {
              if (!PLUGIN_PROPS[event] && /^[A-Z]/.test(event)) {
                throw new Error(
                  `Unknown event ${event} in ${plugin2.postcssPlugin}. Try to update PostCSS (${this.processor.version} now).`
                );
              }
              if (!NOT_VISITORS[event]) {
                if (typeof plugin2[event] === "object") {
                  for (let filter in plugin2[event]) {
                    if (filter === "*") {
                      add(plugin2, event, plugin2[event][filter]);
                    } else {
                      add(
                        plugin2,
                        event + "-" + filter.toLowerCase(),
                        plugin2[event][filter]
                      );
                    }
                  }
                } else if (typeof plugin2[event] === "function") {
                  add(plugin2, event, plugin2[event]);
                }
              }
            }
          }
        }
        this.hasListener = Object.keys(this.listeners).length > 0;
      }
      async runAsync() {
        this.plugin = 0;
        for (let i = 0; i < this.plugins.length; i++) {
          let plugin2 = this.plugins[i];
          let promise = this.runOnRoot(plugin2);
          if (isPromise(promise)) {
            try {
              await promise;
            } catch (error) {
              throw this.handleError(error);
            }
          }
        }
        this.prepareVisitors();
        if (this.hasListener) {
          let root2 = this.result.root;
          while (!root2[isClean]) {
            root2[isClean] = true;
            let stack = [toStack(root2)];
            while (stack.length > 0) {
              let promise = this.visitTick(stack);
              if (isPromise(promise)) {
                try {
                  await promise;
                } catch (e) {
                  let node = stack[stack.length - 1].node;
                  throw this.handleError(e, node);
                }
              }
            }
          }
          if (this.listeners.OnceExit) {
            for (let [plugin2, visitor] of this.listeners.OnceExit) {
              this.result.lastPlugin = plugin2;
              try {
                if (root2.type === "document") {
                  let roots = root2.nodes.map(
                    (subRoot) => visitor(subRoot, this.helpers)
                  );
                  await Promise.all(roots);
                } else {
                  await visitor(root2, this.helpers);
                }
              } catch (e) {
                throw this.handleError(e);
              }
            }
          }
        }
        this.processed = true;
        return this.stringify();
      }
      runOnRoot(plugin2) {
        this.result.lastPlugin = plugin2;
        try {
          if (typeof plugin2 === "object" && plugin2.Once) {
            if (this.result.root.type === "document") {
              let roots = this.result.root.nodes.map(
                (root2) => plugin2.Once(root2, this.helpers)
              );
              if (isPromise(roots[0])) {
                return Promise.all(roots);
              }
              return roots;
            }
            return plugin2.Once(this.result.root, this.helpers);
          } else if (typeof plugin2 === "function") {
            return plugin2(this.result.root, this.result);
          }
        } catch (error) {
          throw this.handleError(error);
        }
      }
      stringify() {
        if (this.error) throw this.error;
        if (this.stringified) return this.result;
        this.stringified = true;
        this.sync();
        let opts = this.result.opts;
        let str = stringify2;
        if (opts.syntax) str = opts.syntax.stringify;
        if (opts.stringifier) str = opts.stringifier;
        if (str.stringify) str = str.stringify;
        let rootSource = this.result.root.source;
        if (opts.map === void 0 && !(rootSource && rootSource.input && rootSource.input.map)) {
          let result = "";
          str(this.result.root, (i) => {
            result += i;
          });
          this.result.css = result;
          return this.result;
        }
        let map = new MapGenerator(str, this.result.root, this.result.opts);
        let data = map.generate();
        this.result.css = data[0];
        this.result.map = data[1];
        return this.result;
      }
      sync() {
        if (this.error) throw this.error;
        if (this.processed) return this.result;
        this.processed = true;
        if (this.processing) {
          throw this.getAsyncError();
        }
        for (let plugin2 of this.plugins) {
          let promise = this.runOnRoot(plugin2);
          if (isPromise(promise)) {
            throw this.getAsyncError();
          }
        }
        this.prepareVisitors();
        if (this.hasListener) {
          let root2 = this.result.root;
          while (!root2[isClean]) {
            root2[isClean] = true;
            this.walkSync(root2);
          }
          if (this.listeners.OnceExit) {
            if (root2.type === "document") {
              for (let subRoot of root2.nodes) {
                this.visitSync(this.listeners.OnceExit, subRoot);
              }
            } else {
              this.visitSync(this.listeners.OnceExit, root2);
            }
          }
        }
        return this.result;
      }
      then(onFulfilled, onRejected) {
        if (true) {
          if (!("from" in this.opts)) {
            warnOnce(
              "Without `from` option PostCSS could generate wrong source map and will not find Browserslist config. Set it to CSS file path or to `undefined` to prevent this warning."
            );
          }
        }
        return this.async().then(onFulfilled, onRejected);
      }
      toString() {
        return this.css;
      }
      visitSync(visitors, node) {
        for (let [plugin2, visitor] of visitors) {
          this.result.lastPlugin = plugin2;
          let promise;
          try {
            promise = visitor(node, this.helpers);
          } catch (e) {
            throw this.handleError(e, node.proxyOf);
          }
          if (node.type !== "root" && node.type !== "document" && !node.parent) {
            return true;
          }
          if (isPromise(promise)) {
            throw this.getAsyncError();
          }
        }
      }
      visitTick(stack) {
        let visit = stack[stack.length - 1];
        let { node, visitors } = visit;
        if (node.type !== "root" && node.type !== "document" && !node.parent) {
          stack.pop();
          return;
        }
        if (visitors.length > 0 && visit.visitorIndex < visitors.length) {
          let [plugin2, visitor] = visitors[visit.visitorIndex];
          visit.visitorIndex += 1;
          if (visit.visitorIndex === visitors.length) {
            visit.visitors = [];
            visit.visitorIndex = 0;
          }
          this.result.lastPlugin = plugin2;
          try {
            return visitor(node.toProxy(), this.helpers);
          } catch (e) {
            throw this.handleError(e, node);
          }
        }
        if (visit.iterator !== 0) {
          let iterator = visit.iterator;
          if (visit.descending) {
            visit.descending = false;
            node.indexes[iterator] += 1;
          }
          let child;
          while (child = node.nodes[node.indexes[iterator]]) {
            if (!child[isClean]) {
              child[isClean] = true;
              visit.descending = true;
              stack.push(toStack(child));
              return;
            }
            node.indexes[iterator] += 1;
          }
          visit.iterator = 0;
          delete node.indexes[iterator];
        }
        let events = visit.events;
        while (visit.eventIndex < events.length) {
          let event = events[visit.eventIndex];
          visit.eventIndex += 1;
          if (event === CHILDREN) {
            if (node.nodes && node.nodes.length) {
              node[isClean] = true;
              visit.iterator = node.getIterator();
            }
            return;
          } else if (this.listeners[event]) {
            visit.visitors = this.listeners[event];
            return;
          }
        }
        stack.pop();
      }
      walkSync(node) {
        node[isClean] = true;
        let stack = [{ eventIndex: 0, events: getEvents(node), iterator: 0, node }];
        while (stack.length > 0) {
          let visit = stack[stack.length - 1];
          let visitNode = visit.node;
          if (visit.iterator !== 0) {
            let iterator = visit.iterator;
            if (visit.descending) {
              visit.descending = false;
              visitNode.indexes[iterator] += 1;
            }
            let child;
            let descended = false;
            while (child = visitNode.nodes[visitNode.indexes[iterator]]) {
              if (!child[isClean]) {
                child[isClean] = true;
                visit.descending = true;
                stack.push({
                  eventIndex: 0,
                  events: getEvents(child),
                  iterator: 0,
                  node: child
                });
                descended = true;
                break;
              }
              visitNode.indexes[iterator] += 1;
            }
            if (descended) continue;
            visit.iterator = 0;
            delete visitNode.indexes[iterator];
          }
          if (visit.eventIndex < visit.events.length) {
            let event = visit.events[visit.eventIndex];
            visit.eventIndex += 1;
            if (event === CHILDREN) {
              if (visitNode.nodes && visitNode.nodes.length) {
                visit.iterator = visitNode.getIterator();
              }
            } else {
              let visitors = this.listeners[event];
              if (visitors) {
                if (this.visitSync(visitors, visitNode.toProxy())) stack.pop();
              }
            }
            continue;
          }
          stack.pop();
        }
      }
      warnings() {
        return this.sync().warnings();
      }
    };
    LazyResult.registerPostcss = (dependant) => {
      postcss2 = dependant;
    };
    module2.exports = LazyResult;
    LazyResult.default = LazyResult;
    Root2.registerLazyResult(LazyResult);
    Document2.registerLazyResult(LazyResult);
  }
});

// node_modules/postcss/lib/no-work-result.js
var require_no_work_result = __commonJS({
  "node_modules/postcss/lib/no-work-result.js"(exports, module2) {
    "use strict";
    var MapGenerator = require_map_generator();
    var parse2 = require_parse();
    var Result2 = require_result();
    var stringify2 = require_stringify();
    var warnOnce = require_warn_once();
    var NoWorkResult = class {
      get content() {
        return this.result.css;
      }
      get css() {
        return this.result.css;
      }
      get map() {
        return this.result.map;
      }
      get messages() {
        return [];
      }
      get opts() {
        return this.result.opts;
      }
      get processor() {
        return this.result.processor;
      }
      get root() {
        if (this._root) {
          return this._root;
        }
        let root2;
        let parser = parse2;
        try {
          root2 = parser(this._css, this._opts);
        } catch (error) {
          this.error = error;
        }
        if (this.error) {
          throw this.error;
        } else {
          this._root = root2;
          return root2;
        }
      }
      get [Symbol.toStringTag]() {
        return "NoWorkResult";
      }
      constructor(processor, css, opts) {
        css = css.toString();
        this.stringified = false;
        this._processor = processor;
        this._css = css;
        this._opts = opts;
        this._map = void 0;
        let str = stringify2;
        this.result = new Result2(this._processor, void 0, this._opts);
        this.result.css = css;
        let self = this;
        Object.defineProperty(this.result, "root", {
          get() {
            return self.root;
          }
        });
        let map = new MapGenerator(str, void 0, this._opts, css);
        if (map.isMap()) {
          let [generatedCSS, generatedMap] = map.generate();
          if (generatedCSS) {
            this.result.css = generatedCSS;
          }
          if (generatedMap) {
            this.result.map = generatedMap;
          }
        } else {
          map.clearAnnotation();
          this.result.css = map.css;
        }
      }
      async() {
        if (this.error) return Promise.reject(this.error);
        return Promise.resolve(this.result);
      }
      catch(onRejected) {
        return this.async().catch(onRejected);
      }
      finally(onFinally) {
        return this.async().then(onFinally, onFinally);
      }
      sync() {
        if (this.error) throw this.error;
        return this.result;
      }
      then(onFulfilled, onRejected) {
        if (true) {
          if (!("from" in this._opts)) {
            warnOnce(
              "Without `from` option PostCSS could generate wrong source map and will not find Browserslist config. Set it to CSS file path or to `undefined` to prevent this warning."
            );
          }
        }
        return this.async().then(onFulfilled, onRejected);
      }
      toString() {
        return this._css;
      }
      warnings() {
        return [];
      }
    };
    module2.exports = NoWorkResult;
    NoWorkResult.default = NoWorkResult;
  }
});

// node_modules/postcss/lib/processor.js
var require_processor = __commonJS({
  "node_modules/postcss/lib/processor.js"(exports, module2) {
    "use strict";
    var Document2 = require_document();
    var LazyResult = require_lazy_result();
    var NoWorkResult = require_no_work_result();
    var Root2 = require_root();
    var Processor2 = class {
      constructor(plugins = []) {
        this.version = "8.5.30";
        this.plugins = this.normalize(plugins);
      }
      normalize(plugins) {
        let normalized = [];
        for (let i of plugins) {
          if (i.postcss === true) {
            i = i();
          } else if (i.postcss) {
            i = i.postcss;
          }
          if (typeof i === "object" && Array.isArray(i.plugins)) {
            normalized = normalized.concat(i.plugins);
          } else if (typeof i === "object" && i.postcssPlugin) {
            normalized.push(i);
          } else if (typeof i === "function") {
            normalized.push(i);
          } else if (typeof i === "object" && (i.parse || i.stringify)) {
            if (true) {
              throw new Error(
                "PostCSS syntaxes cannot be used as plugins. Instead, please use one of the syntax/parser/stringifier options as outlined in your PostCSS runner documentation."
              );
            }
          } else {
            throw new Error(i + " is not a PostCSS plugin");
          }
        }
        return normalized;
      }
      process(css, opts = {}) {
        if (!this.plugins.length && !opts.parser && !opts.stringifier && !opts.syntax) {
          return new NoWorkResult(this, css, opts);
        } else {
          return new LazyResult(this, css, opts);
        }
      }
      use(plugin2) {
        this.plugins = this.plugins.concat(this.normalize([plugin2]));
        return this;
      }
    };
    module2.exports = Processor2;
    Processor2.default = Processor2;
    Root2.registerProcessor(Processor2);
    Document2.registerProcessor(Processor2);
  }
});

// node_modules/postcss/lib/postcss.js
var require_postcss = __commonJS({
  "node_modules/postcss/lib/postcss.js"(exports, module2) {
    "use strict";
    var AtRule2 = require_at_rule();
    var Comment2 = require_comment();
    var Container2 = require_container();
    var CssSyntaxError2 = require_css_syntax_error();
    var Declaration2 = require_declaration();
    var Document2 = require_document();
    var fromJSON2 = require_fromJSON();
    var Input2 = require_input();
    var LazyResult = require_lazy_result();
    var list2 = require_list();
    var Node2 = require_node();
    var parse2 = require_parse();
    var Processor2 = require_processor();
    var Result2 = require_result();
    var Root2 = require_root();
    var Rule2 = require_rule();
    var stringify2 = require_stringify();
    var Warning2 = require_warning();
    function postcss2(...plugins) {
      if (plugins.length === 1 && Array.isArray(plugins[0])) {
        plugins = plugins[0];
      }
      return new Processor2(plugins);
    }
    postcss2.plugin = function plugin2(name, initializer) {
      let warningPrinted = false;
      function creator(...args) {
        if (console && console.warn && !warningPrinted) {
          warningPrinted = true;
          console.warn(
            name + ": postcss.plugin was deprecated. Migration guide:\nhttps://evilmartians.com/chronicles/postcss-8-plugin-migration"
          );
          if (process.env.LANG && process.env.LANG.startsWith("zh")) {
            console.warn(
              name + ": \u91CC\u9762 postcss.plugin \u88AB\u5F03\u7528. \u8FC1\u79FB\u6307\u5357:\nhttps://www.w3ctech.com/topic/2226"
            );
          }
        }
        let transformer = initializer(...args);
        transformer.postcssPlugin = name;
        transformer.postcssVersion = new Processor2().version;
        return transformer;
      }
      let cache;
      Object.defineProperty(creator, "postcss", {
        get() {
          if (!cache) cache = creator();
          return cache;
        }
      });
      creator.process = function(css, processOpts, pluginOpts) {
        return postcss2([creator(pluginOpts)]).process(css, processOpts);
      };
      return creator;
    };
    postcss2.stringify = stringify2;
    postcss2.parse = parse2;
    postcss2.fromJSON = fromJSON2;
    postcss2.list = list2;
    postcss2.comment = (defaults) => new Comment2(defaults);
    postcss2.atRule = (defaults) => new AtRule2(defaults);
    postcss2.decl = (defaults) => new Declaration2(defaults);
    postcss2.rule = (defaults) => new Rule2(defaults);
    postcss2.root = (defaults) => new Root2(defaults);
    postcss2.document = (defaults) => new Document2(defaults);
    postcss2.CssSyntaxError = CssSyntaxError2;
    postcss2.Declaration = Declaration2;
    postcss2.Container = Container2;
    postcss2.Processor = Processor2;
    postcss2.Document = Document2;
    postcss2.Comment = Comment2;
    postcss2.Warning = Warning2;
    postcss2.AtRule = AtRule2;
    postcss2.Result = Result2;
    postcss2.Input = Input2;
    postcss2.Rule = Rule2;
    postcss2.Root = Root2;
    postcss2.Node = Node2;
    LazyResult.registerPostcss(postcss2);
    module2.exports = postcss2;
    postcss2.default = postcss2;
  }
});

// node_modules/postcss-value-parser/lib/parse.js
var require_parse2 = __commonJS({
  "node_modules/postcss-value-parser/lib/parse.js"(exports, module2) {
    var openParentheses = "(".charCodeAt(0);
    var closeParentheses = ")".charCodeAt(0);
    var singleQuote = "'".charCodeAt(0);
    var doubleQuote = '"'.charCodeAt(0);
    var backslash = "\\".charCodeAt(0);
    var slash = "/".charCodeAt(0);
    var comma = ",".charCodeAt(0);
    var colon = ":".charCodeAt(0);
    var star = "*".charCodeAt(0);
    var uLower = "u".charCodeAt(0);
    var uUpper = "U".charCodeAt(0);
    var plus = "+".charCodeAt(0);
    var isUnicodeRange = /^[a-f0-9?-]+$/i;
    module2.exports = function(input) {
      var tokens = [];
      var value = input;
      var next, quote, prev, token, escape, escapePos, whitespacePos, parenthesesOpenPos;
      var pos = 0;
      var code = value.charCodeAt(pos);
      var max = value.length;
      var stack = [{ nodes: tokens }];
      var balanced = 0;
      var parent;
      var name = "";
      var before = "";
      var after = "";
      while (pos < max) {
        if (code <= 32) {
          next = pos;
          do {
            next += 1;
            code = value.charCodeAt(next);
          } while (code <= 32);
          token = value.slice(pos, next);
          prev = tokens[tokens.length - 1];
          if (code === closeParentheses && balanced) {
            after = token;
          } else if (prev && prev.type === "div") {
            prev.after = token;
            prev.sourceEndIndex += token.length;
          } else if (code === comma || code === colon || code === slash && value.charCodeAt(next + 1) !== star && (!parent || parent && parent.type === "function" && parent.value !== "calc")) {
            before = token;
          } else {
            tokens.push({
              type: "space",
              sourceIndex: pos,
              sourceEndIndex: next,
              value: token
            });
          }
          pos = next;
        } else if (code === singleQuote || code === doubleQuote) {
          next = pos;
          quote = code === singleQuote ? "'" : '"';
          token = {
            type: "string",
            sourceIndex: pos,
            quote
          };
          do {
            escape = false;
            next = value.indexOf(quote, next + 1);
            if (~next) {
              escapePos = next;
              while (value.charCodeAt(escapePos - 1) === backslash) {
                escapePos -= 1;
                escape = !escape;
              }
            } else {
              value += quote;
              next = value.length - 1;
              token.unclosed = true;
            }
          } while (escape);
          token.value = value.slice(pos + 1, next);
          token.sourceEndIndex = token.unclosed ? next : next + 1;
          tokens.push(token);
          pos = next + 1;
          code = value.charCodeAt(pos);
        } else if (code === slash && value.charCodeAt(pos + 1) === star) {
          next = value.indexOf("*/", pos);
          token = {
            type: "comment",
            sourceIndex: pos,
            sourceEndIndex: next + 2
          };
          if (next === -1) {
            token.unclosed = true;
            next = value.length;
            token.sourceEndIndex = next;
          }
          token.value = value.slice(pos + 2, next);
          tokens.push(token);
          pos = next + 2;
          code = value.charCodeAt(pos);
        } else if ((code === slash || code === star) && parent && parent.type === "function" && parent.value === "calc") {
          token = value[pos];
          tokens.push({
            type: "word",
            sourceIndex: pos - before.length,
            sourceEndIndex: pos + token.length,
            value: token
          });
          pos += 1;
          code = value.charCodeAt(pos);
        } else if (code === slash || code === comma || code === colon) {
          token = value[pos];
          tokens.push({
            type: "div",
            sourceIndex: pos - before.length,
            sourceEndIndex: pos + token.length,
            value: token,
            before,
            after: ""
          });
          before = "";
          pos += 1;
          code = value.charCodeAt(pos);
        } else if (openParentheses === code) {
          next = pos;
          do {
            next += 1;
            code = value.charCodeAt(next);
          } while (code <= 32);
          parenthesesOpenPos = pos;
          token = {
            type: "function",
            sourceIndex: pos - name.length,
            value: name,
            before: value.slice(parenthesesOpenPos + 1, next)
          };
          pos = next;
          if (name === "url" && code !== singleQuote && code !== doubleQuote) {
            next -= 1;
            do {
              escape = false;
              next = value.indexOf(")", next + 1);
              if (~next) {
                escapePos = next;
                while (value.charCodeAt(escapePos - 1) === backslash) {
                  escapePos -= 1;
                  escape = !escape;
                }
              } else {
                value += ")";
                next = value.length - 1;
                token.unclosed = true;
              }
            } while (escape);
            whitespacePos = next;
            do {
              whitespacePos -= 1;
              code = value.charCodeAt(whitespacePos);
            } while (code <= 32);
            if (parenthesesOpenPos < whitespacePos) {
              if (pos !== whitespacePos + 1) {
                token.nodes = [
                  {
                    type: "word",
                    sourceIndex: pos,
                    sourceEndIndex: whitespacePos + 1,
                    value: value.slice(pos, whitespacePos + 1)
                  }
                ];
              } else {
                token.nodes = [];
              }
              if (token.unclosed && whitespacePos + 1 !== next) {
                token.after = "";
                token.nodes.push({
                  type: "space",
                  sourceIndex: whitespacePos + 1,
                  sourceEndIndex: next,
                  value: value.slice(whitespacePos + 1, next)
                });
              } else {
                token.after = value.slice(whitespacePos + 1, next);
                token.sourceEndIndex = next;
              }
            } else {
              token.after = "";
              token.nodes = [];
            }
            pos = next + 1;
            token.sourceEndIndex = token.unclosed ? next : pos;
            code = value.charCodeAt(pos);
            tokens.push(token);
          } else {
            balanced += 1;
            token.after = "";
            token.sourceEndIndex = pos + 1;
            tokens.push(token);
            stack.push(token);
            tokens = token.nodes = [];
            parent = token;
          }
          name = "";
        } else if (closeParentheses === code && balanced) {
          pos += 1;
          code = value.charCodeAt(pos);
          parent.after = after;
          parent.sourceEndIndex += after.length;
          after = "";
          balanced -= 1;
          stack[stack.length - 1].sourceEndIndex = pos;
          stack.pop();
          parent = stack[balanced];
          tokens = parent.nodes;
        } else {
          next = pos;
          do {
            if (code === backslash) {
              next += 1;
            }
            next += 1;
            code = value.charCodeAt(next);
          } while (next < max && !(code <= 32 || code === singleQuote || code === doubleQuote || code === comma || code === colon || code === slash || code === openParentheses || code === star && parent && parent.type === "function" && parent.value === "calc" || code === slash && parent.type === "function" && parent.value === "calc" || code === closeParentheses && balanced));
          token = value.slice(pos, next);
          if (openParentheses === code) {
            name = token;
          } else if ((uLower === token.charCodeAt(0) || uUpper === token.charCodeAt(0)) && plus === token.charCodeAt(1) && isUnicodeRange.test(token.slice(2))) {
            tokens.push({
              type: "unicode-range",
              sourceIndex: pos,
              sourceEndIndex: next,
              value: token
            });
          } else {
            tokens.push({
              type: "word",
              sourceIndex: pos,
              sourceEndIndex: next,
              value: token
            });
          }
          pos = next;
        }
      }
      for (pos = stack.length - 1; pos; pos -= 1) {
        stack[pos].unclosed = true;
        stack[pos].sourceEndIndex = value.length;
      }
      return stack[0].nodes;
    };
  }
});

// node_modules/postcss-value-parser/lib/walk.js
var require_walk = __commonJS({
  "node_modules/postcss-value-parser/lib/walk.js"(exports, module2) {
    module2.exports = function walk(nodes, cb, bubble) {
      var i, max, node, result;
      for (i = 0, max = nodes.length; i < max; i += 1) {
        node = nodes[i];
        if (!bubble) {
          result = cb(node, i, nodes);
        }
        if (result !== false && node.type === "function" && Array.isArray(node.nodes)) {
          walk(node.nodes, cb, bubble);
        }
        if (bubble) {
          cb(node, i, nodes);
        }
      }
    };
  }
});

// node_modules/postcss-value-parser/lib/stringify.js
var require_stringify2 = __commonJS({
  "node_modules/postcss-value-parser/lib/stringify.js"(exports, module2) {
    function stringifyNode(node, custom) {
      var type = node.type;
      var value = node.value;
      var buf;
      var customResult;
      if (custom && (customResult = custom(node)) !== void 0) {
        return customResult;
      } else if (type === "word" || type === "space") {
        return value;
      } else if (type === "string") {
        buf = node.quote || "";
        return buf + value + (node.unclosed ? "" : buf);
      } else if (type === "comment") {
        return "/*" + value + (node.unclosed ? "" : "*/");
      } else if (type === "div") {
        return (node.before || "") + value + (node.after || "");
      } else if (Array.isArray(node.nodes)) {
        buf = stringify2(node.nodes, custom);
        if (type !== "function") {
          return buf;
        }
        return value + "(" + (node.before || "") + buf + (node.after || "") + (node.unclosed ? "" : ")");
      }
      return value;
    }
    function stringify2(nodes, custom) {
      var result, i;
      if (Array.isArray(nodes)) {
        result = "";
        for (i = nodes.length - 1; ~i; i -= 1) {
          result = stringifyNode(nodes[i], custom) + result;
        }
        return result;
      }
      return stringifyNode(nodes, custom);
    }
    module2.exports = stringify2;
  }
});

// node_modules/postcss-value-parser/lib/unit.js
var require_unit = __commonJS({
  "node_modules/postcss-value-parser/lib/unit.js"(exports, module2) {
    var minus = "-".charCodeAt(0);
    var plus = "+".charCodeAt(0);
    var dot = ".".charCodeAt(0);
    var exp = "e".charCodeAt(0);
    var EXP = "E".charCodeAt(0);
    function likeNumber(value) {
      var code = value.charCodeAt(0);
      var nextCode;
      if (code === plus || code === minus) {
        nextCode = value.charCodeAt(1);
        if (nextCode >= 48 && nextCode <= 57) {
          return true;
        }
        var nextNextCode = value.charCodeAt(2);
        if (nextCode === dot && nextNextCode >= 48 && nextNextCode <= 57) {
          return true;
        }
        return false;
      }
      if (code === dot) {
        nextCode = value.charCodeAt(1);
        if (nextCode >= 48 && nextCode <= 57) {
          return true;
        }
        return false;
      }
      if (code >= 48 && code <= 57) {
        return true;
      }
      return false;
    }
    module2.exports = function(value) {
      var pos = 0;
      var length = value.length;
      var code;
      var nextCode;
      var nextNextCode;
      if (length === 0 || !likeNumber(value)) {
        return false;
      }
      code = value.charCodeAt(pos);
      if (code === plus || code === minus) {
        pos++;
      }
      while (pos < length) {
        code = value.charCodeAt(pos);
        if (code < 48 || code > 57) {
          break;
        }
        pos += 1;
      }
      code = value.charCodeAt(pos);
      nextCode = value.charCodeAt(pos + 1);
      if (code === dot && nextCode >= 48 && nextCode <= 57) {
        pos += 2;
        while (pos < length) {
          code = value.charCodeAt(pos);
          if (code < 48 || code > 57) {
            break;
          }
          pos += 1;
        }
      }
      code = value.charCodeAt(pos);
      nextCode = value.charCodeAt(pos + 1);
      nextNextCode = value.charCodeAt(pos + 2);
      if ((code === exp || code === EXP) && (nextCode >= 48 && nextCode <= 57 || (nextCode === plus || nextCode === minus) && nextNextCode >= 48 && nextNextCode <= 57)) {
        pos += nextCode === plus || nextCode === minus ? 3 : 2;
        while (pos < length) {
          code = value.charCodeAt(pos);
          if (code < 48 || code > 57) {
            break;
          }
          pos += 1;
        }
      }
      return {
        number: value.slice(0, pos),
        unit: value.slice(pos)
      };
    };
  }
});

// node_modules/postcss-value-parser/lib/index.js
var require_lib = __commonJS({
  "node_modules/postcss-value-parser/lib/index.js"(exports, module2) {
    var parse2 = require_parse2();
    var walk = require_walk();
    var stringify2 = require_stringify2();
    function ValueParser(value) {
      if (this instanceof ValueParser) {
        this.nodes = parse2(value);
        return this;
      }
      return new ValueParser(value);
    }
    ValueParser.prototype.toString = function() {
      return Array.isArray(this.nodes) ? stringify2(this.nodes) : "";
    };
    ValueParser.prototype.walk = function(cb, bubble) {
      walk(this.nodes, cb, bubble);
      return this;
    };
    ValueParser.unit = require_unit();
    ValueParser.walk = walk;
    ValueParser.stringify = stringify2;
    module2.exports = ValueParser;
  }
});

// packages/dsh-px-workbench/src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// packages/shared/ui.tsx
var import_react = require("react");

// packages/shared/owned-style.ts
function installOwnedStyle(ctx, key, css) {
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error("Invalid PX stylesheet key");
  ctx.effect?.(() => {
    const style = document.querySelector(`style[data-dsh-px-style="${key}"]`) ?? document.createElement("style");
    style.dataset.dshPxStyle = key;
    style.setAttribute("data-plugin", `dsh-px-effect:${key}`);
    style.textContent = css;
    style.dataset.users = String(Number(style.dataset.users ?? 0) + 1);
    if (!style.isConnected) document.head.appendChild(style);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const users = Number(style.dataset.users) - 1;
      style.dataset.users = String(users);
      if (users <= 0) style.remove();
    };
  }, `px: ${key} stylesheet`);
}

// packages/shared/ui.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var uiCss = `
.px-ui{--px-bg:var(--dsw-alias-bg-base,#fff);--px-layer:var(--dsw-alias-bg-layer-1,#f8f9fb);--px-fg:var(--dsw-alias-label-primary,#20242d);--px-muted:var(--dsw-alias-label-secondary,#657080);--px-border:var(--dsw-alias-border-l2,#d9dee7);--px-accent:var(--dsw-alias-state-business-primary,#466dea);--px-error:var(--dsw-alias-state-error-primary,#bc3946);color:var(--px-fg);font-size:13px;line-height:1.6}
.px-ui button,.px-ui input,.px-ui select,.px-ui textarea{font:inherit;color:inherit}
.px-ui button{min-height:32px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:5px 11px;border:1px solid var(--px-border);border-radius:8px;background:var(--px-bg);cursor:pointer;transition:background-color 130ms ease,border-color 130ms ease,color 130ms ease,box-shadow 130ms ease,transform 100ms ease}
.px-ui button:not(:disabled):hover{background:color-mix(in srgb,var(--px-fg) 7%,var(--px-bg));border-color:color-mix(in srgb,var(--px-fg) 25%,var(--px-border))}
.px-ui button:not(:disabled):active{transform:translateY(1px)}
.px-ui button:disabled{cursor:default!important;opacity:.45}
.px-ui :is(button,input,select,textarea,summary):focus-visible{outline:2px solid var(--px-accent);outline-offset:2px}
.px-ui :is(input,select,textarea){border:1px solid var(--px-border);border-radius:8px;background:var(--px-bg);padding:7px 9px;box-sizing:border-box;transition:border-color 130ms ease,box-shadow 130ms ease}
.px-ui textarea{resize:vertical}.px-ui input[type=checkbox]{accent-color:var(--px-accent)}
.px-ui .px-primary{background:color-mix(in srgb,var(--px-accent) 12%,var(--px-bg));border-color:var(--px-accent);color:var(--px-accent)}
.px-ui .px-danger,.px-ui [role=alert]{color:var(--px-error)}
.px-ui .px-muted{color:var(--px-muted);font-size:12px}.px-ui [role=status]{overflow-wrap:anywhere}
.px-ui .px-card{border:1px solid var(--px-border);border-radius:10px;padding:14px;margin:12px 0;background:var(--px-bg)}
.px-ui .px-empty{border:1px dashed var(--px-border);border-radius:10px;padding:18px;text-align:center;color:var(--px-muted);margin:14px 0}
.px-ui .px-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0}
.px-ui .px-feedback{border-left:3px solid var(--px-accent);padding:7px 10px;background:var(--px-layer);border-radius:5px;animation:px-feedback-in 150ms ease-out}
.px-ui .px-confirm-delete{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;padding:5px;border:1px solid var(--px-error);border-radius:8px}
.px-icon{width:16px;height:16px;flex:none;display:inline-block;vertical-align:middle}
@keyframes px-feedback-in{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.px-ui,.px-ui *{animation:none!important;transition:none!important;scroll-behavior:auto!important}.px-ui button:not(:disabled):active{transform:none}}
`;
function installUiStyles(ctx) {
  installOwnedStyle(ctx, "shared-ui", uiCss);
}
var controlStyle = {
  borderRadius: 8,
  padding: "5px 11px",
  minHeight: 32,
  color: "inherit",
  cursor: "pointer",
  fontSize: 13
};
var cardStyle = { border: "1px solid var(--px-border)", borderRadius: 10, padding: 14, minWidth: 0 };

// packages/dsh-px-workbench/src/client.tsx
var import_react4 = require("react");

// packages/shared/client-http.ts
var RequestError = class extends Error {
  constructor(message, status, code, retryable = true) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.name = "RequestError";
  }
};
async function requestJson(path, init = {}) {
  const controller = new AbortController();
  const caller = init.signal;
  const cancel = () => controller.abort(caller?.reason);
  if (caller?.aborted) cancel();
  else caller?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 2e4);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    headers.set("x-dsh-px-request", "1");
    const response = await fetch(path, { ...init, signal: controller.signal, headers });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new RequestError(
        `\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BFB\u53D6\u7684\u54CD\u5E94\uFF08HTTP ${response.status}\uFF09\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5\u6216\u68C0\u67E5\u65E5\u5FD7\u3002`,
        response.status || 502,
        "INVALID_RESPONSE",
        response.status >= 500 || response.ok
      );
    }
    if (!response.ok) {
      throw new RequestError(
        typeof body?.error === "string" ? body.error : `HTTP ${response.status}`,
        response.status,
        typeof body?.code === "string" ? body.code : void 0,
        typeof body?.retryable === "boolean" ? body.retryable : response.status >= 500
      );
    }
    return body;
  } catch (error) {
    if (timedOut)
      throw new Error(
        init.method && init.method !== "GET" ? "\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u5148\u5237\u65B0\u8BB0\u5F55\u786E\u8BA4\u7ED3\u679C\uFF0C\u907F\u514D\u91CD\u590D\u64CD\u4F5C\u3002" : "\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5"
      );
    if (caller?.aborted) throw caller.reason ?? new DOMException("\u8BF7\u6C42\u5DF2\u53D6\u6D88", "AbortError");
    if (error instanceof TypeError && /fetch|network/i.test(error.message))
      throw new Error("\u65E0\u6CD5\u8FDE\u63A5\u670D\u52A1\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5");
    throw error;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", cancel);
  }
}

// packages/shared/client-capabilities.ts
function pageCarrier(value) {
  return Boolean(
    value && typeof value === "object" && Number.isSafeInteger(value.protocolVersion) && value.protocolVersion > 0
  ) ? "desktop" : "browser";
}
function createCapabilities(initial) {
  let value = initial;
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      value = { ...value, ...next };
      for (const listener of listeners) listener();
    }
  };
}

// packages/dsh-px-workbench/src/html-preview.tsx
var import_react2 = require("react");

// node_modules/postcss/lib/postcss.mjs
var import_postcss = __toESM(require_postcss(), 1);
var postcss_default = import_postcss.default;
var stringify = import_postcss.default.stringify;
var fromJSON = import_postcss.default.fromJSON;
var plugin = import_postcss.default.plugin;
var parse = import_postcss.default.parse;
var list = import_postcss.default.list;
var document2 = import_postcss.default.document;
var comment = import_postcss.default.comment;
var atRule = import_postcss.default.atRule;
var rule = import_postcss.default.rule;
var decl = import_postcss.default.decl;
var root = import_postcss.default.root;
var CssSyntaxError = import_postcss.default.CssSyntaxError;
var Declaration = import_postcss.default.Declaration;
var Container = import_postcss.default.Container;
var Processor = import_postcss.default.Processor;
var Document = import_postcss.default.Document;
var Comment = import_postcss.default.Comment;
var Warning = import_postcss.default.Warning;
var AtRule = import_postcss.default.AtRule;
var Result = import_postcss.default.Result;
var Input = import_postcss.default.Input;
var Rule = import_postcss.default.Rule;
var Root = import_postcss.default.Root;
var Node = import_postcss.default.Node;

// packages/dsh-px-workbench/src/html-assets.ts
var import_postcss_value_parser = __toESM(require_lib(), 1);
var MAX_FILE = 4 * 1024 * 1024;
var MAX_TOTAL = 32 * 1024 * 1024;
var MAX_FILES = 64;
var encoder = new TextEncoder();
var decoder = new TextDecoder("utf-8", { fatal: true });
var media = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm"
};
function localPreviewReference(reference) {
  return !!reference && !/^(?:[a-z][a-z\d+.-]*:|[/\\#?])/iu.test(reference);
}
function dataUrl(bytes, type) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return `data:${type};base64,${btoa(binary)}`;
}
async function prepareHtmlPreview(html, baseFile, read, signal) {
  let total = encoder.encode(html).length, count = 0;
  if (total > MAX_TOTAL) throw Error("HTML \u8D85\u8FC7\u9884\u89C8\u5927\u5C0F\u9650\u5236");
  const cache = /* @__PURE__ */ new Map();
  async function load(reference, base2) {
    signal.throwIfAborted();
    const path = decodeURIComponent(reference.split(/[?#]/u, 1)[0]);
    if (!localPreviewReference(path) || path.includes("\0") || path.includes("\\"))
      throw Error("\u672C\u5730\u8D44\u6E90\u9700\u8981\u4F7F\u7528\u76F8\u5BF9\u6587\u4EF6\u8DEF\u5F84");
    const key = base2 + "\0" + path;
    if (!cache.has(key)) {
      if (++count > MAX_FILES) throw Error("HTML \u5F15\u7528\u8D44\u6E90\u8FC7\u591A\uFF0C\u8BF7\u901A\u8FC7\u5F00\u53D1\u670D\u52A1\u5668\u9884\u89C8");
      cache.set(
        key,
        (async () => {
          const file = await read(path, base2, signal);
          signal.throwIfAborted();
          if (!file.eof || file.data.byteLength > MAX_FILE) throw Error("\u9884\u89C8\u8D44\u6E90\u8FC7\u5927\uFF1A" + reference);
          total += file.data.byteLength;
          if (total > MAX_TOTAL) throw Error("HTML \u548C\u8D44\u6E90\u8D85\u8FC7\u9884\u89C8\u603B\u5927\u5C0F\u9650\u5236");
          return file;
        })()
      );
    }
    return cache.get(key);
  }
  async function binary(reference, base2) {
    if (!localPreviewReference(reference)) return reference;
    const file = await load(reference, base2), ext = file.absolutePath.split(".").at(-1)?.toLowerCase() ?? "", type = media[ext];
    if (!type) throw Error("\u6B64\u8D44\u6E90\u7C7B\u578B\u9700\u8981\u901A\u8FC7\u5F00\u53D1\u670D\u52A1\u5668\u9884\u89C8\uFF1A" + reference);
    const fragment = reference.includes("#") ? "#" + reference.split("#").slice(1).join("#") : "";
    return dataUrl(file.data, type) + fragment;
  }
  async function values(value, base2) {
    const parsed = (0, import_postcss_value_parser.default)(value), pending = [];
    parsed.walk((node) => {
      if (node.type !== "function" || node.value.toLowerCase() !== "url") return;
      const reference = import_postcss_value_parser.default.stringify(node.nodes).trim().replace(/^(['"])([\s\S]*)\1$/u, "$2");
      if (localPreviewReference(reference))
        pending.push(
          binary(reference, base2).then((url) => {
            node.nodes = [{ type: "string", quote: '"', value: url, sourceIndex: 0, sourceEndIndex: 0 }];
          })
        );
      return false;
    });
    await Promise.all(pending);
    return parsed.toString();
  }
  async function stylesheet(text, base2, ancestors = []) {
    if (ancestors.includes(base2) || ancestors.length >= 6) throw Error("\u6837\u5F0F\u8868\u5B58\u5728\u5FAA\u73AF\u6216\u8FC7\u6DF1\u5F15\u7528");
    const root2 = postcss_default.parse(text, { from: void 0 }), imports = [], decls = [];
    root2.walkAtRules("import", (r) => {
      imports.push(r);
    });
    for (const rule2 of imports) {
      const parsed = (0, import_postcss_value_parser.default)(rule2.params), first = parsed.nodes.find((n) => n.type !== "space" && n.type !== "comment");
      const reference = first?.type === "string" ? first.value : first?.type === "function" && first.value.toLowerCase() === "url" ? import_postcss_value_parser.default.stringify(first.nodes).replace(/^(['"])([\s\S]*)\1$/u, "$2") : void 0;
      if (!reference || !localPreviewReference(reference)) continue;
      const file = await load(reference, base2), nested = await stylesheet(decoder.decode(file.data), file.absolutePath, [...ancestors, base2]);
      const tail = rule2.params.slice(first.sourceEndIndex).trim();
      if (/\b(?:layer|supports)\b/u.test(tail)) throw Error("\u6B64\u6837\u5F0F\u5BFC\u5165\u9700\u8981\u901A\u8FC7\u5F00\u53D1\u670D\u52A1\u5668\u9884\u89C8");
      rule2.replaceWith(postcss_default.parse(tail ? `@media ${tail}{${nested}}` : nested, { from: void 0 }));
    }
    root2.walkDecls((d) => {
      decls.push(d);
    });
    for (const d of decls) d.value = await values(d.value, base2);
    signal.throwIfAborted();
    return root2.toString();
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  const base = template.content.querySelector("base[href]")?.getAttribute("href");
  if (base && !/^https?:\/\//iu.test(base)) throw Error("\u5E26\u672C\u5730 base \u8DEF\u5F84\u7684\u9875\u9762\u9700\u8981\u901A\u8FC7\u5F00\u53D1\u670D\u52A1\u5668\u9884\u89C8");
  if (!base) {
    for (const el of template.content.querySelectorAll("script[src],link[href]")) {
      const script = el.localName === "script", attr = script ? "src" : "href", ref = el.getAttribute(attr) ?? "";
      if (!localPreviewReference(ref)) continue;
      if (!script && !(el.getAttribute("rel") ?? "").toLowerCase().split(/\s+/u).includes("stylesheet"))
        continue;
      if (script && !["", "text/javascript", "application/javascript"].includes(
        (el.getAttribute("type") ?? "").trim().toLowerCase()
      ))
        throw Error("\u672C\u5730\u6A21\u5757\u811A\u672C\u9700\u8981\u901A\u8FC7\u5F00\u53D1\u670D\u52A1\u5668\u9884\u89C8");
      const file = await load(ref, baseFile), source = decoder.decode(file.data);
      const text = script ? source : await stylesheet(source, file.absolutePath);
      el.setAttribute(attr, dataUrl(encoder.encode(text), script ? "application/javascript" : "text/css"));
      el.removeAttribute("integrity");
    }
    for (const el of template.content.querySelectorAll(
      "img[src],image[href],image[xlink\\:href],source[src],audio[src],video[src],video[poster]"
    )) {
      for (const attr of ["src", "href", "xlink:href", "poster"]) {
        const ref = el.getAttribute(attr);
        if (ref) el.setAttribute(attr, await binary(ref, baseFile));
      }
    }
    for (const el of template.content.querySelectorAll("style"))
      el.textContent = await stylesheet(el.textContent ?? "", baseFile);
    for (const el of template.content.querySelectorAll("[style]")) {
      const sheet = postcss_default.parse(`a{${el.getAttribute("style")}}`, { from: void 0 });
      const rule2 = sheet.first;
      for (const decl2 of rule2?.nodes ?? [])
        if (decl2.type === "decl") decl2.value = await values(decl2.value, baseFile);
      el.setAttribute("style", (rule2?.nodes ?? []).map((n) => n.toString()).join(";"));
    }
    for (const el of template.content.querySelectorAll("[srcset],iframe[src],object[data],embed[src]")) {
      const value = el.getAttribute("srcset") ?? el.getAttribute("src") ?? el.getAttribute("data") ?? "";
      if (localPreviewReference(value)) throw Error("\u6B64\u9875\u9762\u5305\u542B\u5C1A\u672A\u6253\u5305\u7684\u672C\u5730\u8D44\u6E90\uFF0C\u8BF7\u901A\u8FC7\u5F00\u53D1\u670D\u52A1\u5668\u9884\u89C8");
    }
  }
  signal.throwIfAborted();
  return "<!doctype html>" + template.innerHTML;
}

// packages/shared/native-navigation.ts
function nativeFileAddress(sessionId, path) {
  if (!sessionId || !path || /[\r\n\0]/.test(path)) throw new Error("\u6587\u4EF6\u5730\u5740\u65E0\u6548");
  const encode = (segment) => encodeURIComponent(segment).replace(/%3A/gi, ":");
  return `dsh-resource://file/session/${encode(sessionId)}/${path.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "").split("/").map(encode).join("/")}`;
}

// packages/dsh-px-workbench/src/html-preview.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function HtmlPreview({
  scope,
  path,
  content,
  truncated,
  className,
  read,
  dirty
}) {
  const key = scope.sessionId + "\0" + path + "\0" + content;
  const [state, setState] = (0, import_react2.useState)(void 0);
  (0, import_react2.useEffect)(() => {
    const ac = new AbortController();
    let url;
    void (async () => {
      try {
        if (truncated) throw Error("\u6587\u4EF6\u672A\u5B8C\u6574\u8BFB\u53D6\uFF0C\u8BF7\u7528\u5916\u90E8\u6D4F\u89C8\u5668\u6253\u5F00");
        if (content === void 0) throw Error("\u6587\u4EF6\u5185\u5BB9\u5C1A\u672A\u5C31\u7EEA");
        const html = await prepareHtmlPreview(content, path, read, ac.signal);
        ac.signal.throwIfAborted();
        url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        setState({ key, url });
      } catch (e) {
        if (!ac.signal.aborted) setState({ key, error: e.message ?? String(e) });
      }
    })();
    return () => {
      ac.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [key, path, content, truncated, read]);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className, style: { display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 12, padding: "6px 10px", color: "var(--dsw-alias-label-secondary)" }, children: [
      dirty ? "\u672A\u4FDD\u5B58\u7684\u9884\u89C8" : "\u6C99\u7BB1\u9884\u89C8",
      " \xB7 \u52A8\u6001\u672C\u5730\u8BF7\u6C42\u8BF7\u901A\u8FC7\u5F00\u53D1\u670D\u52A1\u5668\u6253\u5F00"
    ] }),
    state?.key !== key ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", children: "\u6B63\u5728\u51C6\u5907 HTML \u4E0E\u672C\u5730\u8D44\u6E90\u2026" }) : state.error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "alert", children: [
      "\u65E0\u6CD5\u9884\u89C8\uFF1A",
      state.error
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "iframe",
      {
        title: path,
        src: state.url,
        sandbox: "allow-scripts allow-popups allow-downloads allow-modals",
        referrerPolicy: "no-referrer",
        style: { width: "100%", flex: 1, border: 0, minHeight: 0 }
      }
    )
  ] });
}
function installHtmlPreview(ctx) {
  ctx.inject(
    ["sidebarRight"],
    (host) => host.provide("pxFilePreviewLinks", {
      open: (scope, path) => host.sidebarRight.openResourceIn(scope.sessionId, nativeFileAddress(scope.sessionId, path))
    })
  );
  ctx.inject(["remote", "remote.workspaceFiles"], (host) => {
    const component = (props) => {
      const read = (0, import_react2.useMemo)(
        () => async (reference, baseFile, signal) => {
          const result = await host.remote.workspaceFiles.readBytes(
            props.scope.sessionId,
            reference,
            { baseFile },
            signal
          );
          if (!result.ok) throw Error(result.error.message);
          if (!(result.value.data instanceof Uint8Array)) throw Error("\u539F\u751F\u6587\u4EF6\u670D\u52A1\u8FD4\u56DE\u4E86\u4E0D\u652F\u6301\u7684\u5B57\u8282\u683C\u5F0F");
          return result.value;
        },
        [props.scope.sessionId]
      );
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(HtmlPreview, { ...props, read });
    };
    host.provide("pxHtmlPreview", { component });
  });
}

// packages/dsh-px-workbench/src/context-model-select.tsx
var import_react3 = require("react");

// packages/shared/context-policy.ts
var TIER_LABELS = {
  minimum: "\u6700\u4F4E\u9650\u5EA6",
  brief: "\u7B80\u7565",
  full: "\u5B8C\u6574"
};

// packages/dsh-px-workbench/src/model-selection-observer.ts
function observeRejectedModelSelection(store, inspect, receive) {
  let attempted;
  let check;
  const stop = store.subscribe(() => {
    const state = store.getSnapshot();
    check?.abort();
    if (state.pending) {
      attempted = state.pending;
      return;
    }
    const selection = attempted;
    attempted = void 0;
    if (state.status !== "error" || !selection) return;
    const controller = check = new AbortController();
    void inspect(selection, controller.signal).then((value) => {
      if (!controller.signal.aborted) receive(selection, value);
    }).catch(() => {
    });
  });
  return () => {
    stop();
    check?.abort();
  };
}

// packages/dsh-px-workbench/src/context-model-select.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function query(sessionId, selection) {
  return "/dsh-px-workbench/context-policy?" + new URLSearchParams({ sessionId, provider: selection.provider, model: selection.model });
}
function ModelSeat({ openSession, pxSessionId, ...props }) {
  const [snapshot, setSnapshot] = (0, import_react3.useState)(props.directory.getSnapshot);
  (0, import_react3.useEffect)(() => {
    const refresh = () => setSnapshot(props.directory.getSnapshot());
    const stop = props.directory.subscribe(refresh);
    refresh();
    return stop;
  }, [props.directory]);
  const [status, setStatus] = (0, import_react3.useState)(null), [error, setError] = (0, import_react3.useState)("");
  const [pending, setPending] = (0, import_react3.useState)(
    null
  );
  const [busy, setBusy] = (0, import_react3.useState)(false), alive = (0, import_react3.useRef)(true);
  const dialog = (0, import_react3.useRef)(null);
  (0, import_react3.useEffect)(
    () => observeRejectedModelSelection(
      props.directory,
      (selection, signal) => requestJson(query(pxSessionId, selection), { signal }),
      (selection, value) => {
        if (value.requiresContinuation) {
          setError("");
          setPending({ selection, status: value, requestId: crypto.randomUUID() });
        }
      }
    ),
    [props.directory, pxSessionId]
  );
  (0, import_react3.useEffect)(() => {
    if (pending && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [pending]);
  (0, import_react3.useEffect)(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  (0, import_react3.useEffect)(() => {
    const ac = new AbortController();
    setStatus(null);
    if (snapshot.current)
      void requestJson(query(pxSessionId, snapshot.current), { signal: ac.signal }).then((value) => {
        if (!ac.signal.aborted) setStatus(value);
      }).catch(() => {
      });
    return () => ac.abort();
  }, [pxSessionId, snapshot.current?.provider, snapshot.current?.model, snapshot.groups]);
  async function continueSession() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestJson(
        "/dsh-px-memory?sessionId=" + encodeURIComponent(pxSessionId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "new-model-session",
            requestId: pending.requestId,
            ...pending.selection
          })
        }
      );
      if (alive.current) {
        setPending(null);
        openSession(result.createdSessionId);
      }
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
    status && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "span",
      {
        title: (status.nativeGuard ? "" : "\u6B64\u5BBF\u4E3B\u53EA\u63D0\u4F9B\u8BF7\u6C42\u524D\u68C0\u67E5\uFF1B\u5B8C\u6574\u5207\u6362\u7EA6\u675F\u9700\u8981 PX Desktop 0.7\u3002") + (status.target.capacity ? `${status.target.capacity.toLocaleString()} tokens\uFF1B\u540C\u6863\u4ECD\u6309\u5B9E\u9645\u5BB9\u91CF\u6821\u9A8C` : "\u7A97\u53E3\u672A\u58F0\u660E\uFF0C\u6309\u6700\u4F4E\u6863\u6CE8\u5165\uFF1B\u8BF7\u5728\u6A21\u578B\u8BBE\u7F6E\u4E2D\u586B\u5199\u5BB9\u91CF"),
        style: { fontSize: 11, opacity: 0.65, whiteSpace: "nowrap" },
        children: [
          TIER_LABELS[status.bound ?? status.target.tier],
          status.target.capacity ? "" : " \xB7 \u672A\u58F0\u660E"
        ]
      }
    ),
    status?.requiresContinuation && snapshot.current && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "button",
      {
        style: { ...controlStyle, fontSize: 12 },
        onClick: () => setPending({ selection: snapshot.current, status, requestId: crypto.randomUUID() }),
        children: "\u65B0\u6863\u4F4D\u63A5\u7EED"
      }
    ),
    !pending && error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { role: "alert", style: { fontSize: 12 }, children: error }),
    pending && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "dialog",
      {
        ref: dialog,
        className: "px-ui",
        "aria-label": "\u6362\u6863\u63A5\u7EED\u4F1A\u8BDD",
        onCancel: (e) => {
          e.preventDefault();
          if (!busy) {
            setPending(null);
            setError("");
          }
        },
        style: {
          ...cardStyle,
          width: 400,
          maxWidth: "90vw",
          padding: 20,
          background: "var(--px-bg)",
          color: "var(--px-fg)"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "\u7528\u65B0\u6A21\u578B\u63A5\u7EED\u4F1A\u8BDD" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
            "\u4ECE\u300C",
            TIER_LABELS[pending.status.bound],
            "\u300D\u5207\u6362\u5230\u300C",
            TIER_LABELS[pending.status.target.tier],
            "\u300D\u6863\u9700\u8981\u65B0\u4F1A\u8BDD\u3002"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u4FDD\u7559\u5F53\u524D\u4EBA\u683C\u4E0E\u5DE5\u4F5C\u533A\uFF0C\u63D0\u4F9B\u5386\u53F2\u548C\u5DE5\u4F5C\u8D26\u672C\u7684\u63A5\u7EED\u5165\u53E3\u3002\u539F\u4F1A\u8BDD\u8349\u7A3F\u7559\u5728\u539F\u5904\uFF1B\u65B0\u4F1A\u8BDD\u4E0D\u4F1A\u81EA\u52A8\u53D1\u9001\u6D88\u606F\u6216\u6062\u590D\u4EFB\u52A1\u3002" }),
          error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "alert", children: error }),
          !pending.status.canContinue && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u8BF7\u5148\u542F\u7528\u201C\u4EBA\u683C\u4E0E\u7ECF\u5386\u201D\u63D2\u4EF6\u4EE5\u63A5\u7EED\u5386\u53F2\uFF1B\u4E5F\u53EF\u4EE5\u4ECE\u5DE6\u4FA7\u65B0\u5EFA\u7A7A\u767D\u4F1A\u8BDD\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                style: controlStyle,
                disabled: busy,
                onClick: () => {
                  setPending(null);
                  setError("");
                },
                children: "\u53D6\u6D88"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                style: controlStyle,
                disabled: busy || !pending.status.canContinue,
                onClick: () => void continueSession(),
                children: busy ? "\u6B63\u5728\u521B\u5EFA\u2026" : "\u65B0\u5EFA\u63A5\u7EED\u4F1A\u8BDD"
              }
            )
          ] })
        ]
      }
    )
  ] });
}
function installContextModelSelect(ctx) {
  ctx.inject(
    ["slots", "uiWorkspace", "modelDirectories", "sessions"],
    (host) => host.slots.inject(
      "conversation.input.right",
      () => host.slots.register(
        {
          name: "conversation.input.right",
          id: "dsh-px-context",
          order: 80,
          inject: (sessionId) => ({
            pxSessionId: sessionId,
            available: host.sessions.subagentAddress(sessionId) === void 0,
            directory: host.modelDirectories.directoryFor(sessionId).store
          })
        },
        (props) => props.available ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          ModelSeat,
          {
            ...props,
            openSession: (id) => host.uiWorkspace.openSession(id)
          },
          props.pxSessionId
        ) : null
      )
    )
  );
}

// packages/dsh-px-workbench/src/client.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
var inject = ["slots", "locale"];
var prefix = "/dsh-px-workbench";
var button = controlStyle;
var card = { ...cardStyle, marginBottom: 12 };
var prompts = [
  {
    title: "\u719F\u6089\u9879\u76EE",
    text: "\u5148\u9605\u8BFB\u5F53\u524D\u5DE5\u4F5C\u533A\u7684\u8BF4\u660E\u548C\u4EE3\u7801\uFF0C\u89E3\u91CA\u9879\u76EE\u7684\u7528\u9014\u3001\u8FD0\u884C\u65B9\u5F0F\u4E0E\u6700\u503C\u5F97\u4FEE\u590D\u7684\u4E00\u4E2A\u95EE\u9898\u3002\u8BF7\u7ED9\u51FA\u6587\u4EF6\u4F9D\u636E\uFF0C\u8FD9\u4E00\u6B65\u5148\u4E0D\u8981\u4FEE\u6539\u4EE3\u7801\u3002"
  },
  {
    title: "\u5B8C\u6210\u4E00\u6B21\u4FEE\u6539",
    text: "\u5728\u5F53\u524D\u5DE5\u4F5C\u533A\u5B8C\u6210\u4E0B\u9762\u7684\u4FEE\u6539\uFF1A[\u586B\u5199\u9700\u6C42]\u3002\u5148\u8BFB\u9879\u76EE\u7EA6\u5B9A\uFF0C\u8BF4\u660E\u5F71\u54CD\u8303\u56F4\uFF0C\u518D\u5B9E\u73B0\u5E76\u8FD0\u884C\u76F8\u5173\u9A8C\u8BC1\uFF1B\u6700\u540E\u5217\u51FA\u4FEE\u6539\u6587\u4EF6\u3001\u9A8C\u8BC1\u7ED3\u679C\u548C\u672A\u89E3\u51B3\u7684\u95EE\u9898\u3002"
  },
  {
    title: "\u9A8C\u8BC1\u5DE5\u5177\u53EF\u7528",
    text: "\u5728\u5F53\u524D\u5DE5\u4F5C\u533A\u521B\u5EFA agent-smoke.txt\uFF0C\u5199\u5165 DSH-PX agent smoke OK\u3002\u5FC5\u987B\u5B9E\u9645\u8C03\u7528\u6587\u4EF6\u5DE5\u5177\u5199\u5165\uFF0C\u518D\u7528 Shell \u8BFB\u53D6\u9A8C\u8BC1\uFF0C\u62A5\u544A\u5B9E\u9645\u8DEF\u5F84\u4E0E\u8BFB\u53D6\u5185\u5BB9\u3002\u4E0D\u8981\u4FEE\u6539\u5176\u4ED6\u6587\u4EF6\u3002"
  }
];
var dependencyLabels = {
  sessions: "\u4F1A\u8BDD\u72B6\u6001",
  uiWorkspace: "\u4F1A\u8BDD\u4E0E\u5DE5\u4F5C\u533A\u64CD\u4F5C",
  conversation: "\u4F1A\u8BDD\u8F93\u5165\u4E0E\u5F15\u7528",
  betterSidebar: "\u4FA7\u8FB9\u5361\u7247\uFF08\u6587\u4EF6\u3001\u4EA7\u7269\u3001\u6279\u6CE8\u3001\u5B9A\u65F6\u4EFB\u52A1\u3001\u6267\u884C\u8BB0\u5F55\uFF09",
  sidebarRight: "\u539F\u751F\u7EC8\u7AEF\u5BB9\u5668"
};
function Workbench({ capabilities }) {
  const [activated, setActivated] = (0, import_react4.useState)(capabilities.getSnapshot);
  (0, import_react4.useEffect)(() => capabilities.subscribe(() => setActivated(capabilities.getSnapshot())), [capabilities]);
  const carrier = pageCarrier(window.dshDesktop);
  const [data, setData] = (0, import_react4.useState)(null);
  const [error, setError] = (0, import_react4.useState)(null);
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [message, setMessage] = (0, import_react4.useState)("");
  const [path, setPath] = (0, import_react4.useState)("");
  const [adding, setAdding] = (0, import_react4.useState)(false);
  const [workspaceMessage, setWorkspaceMessage] = (0, import_react4.useState)("");
  const [networkCheck, setNetworkCheck] = (0, import_react4.useState)(null);
  const [networkBusy, setNetworkBusy] = (0, import_react4.useState)(false);
  const [networkError, setNetworkError] = (0, import_react4.useState)("");
  async function checkNetwork() {
    setNetworkBusy(true);
    setNetworkError("");
    try {
      setNetworkCheck(await requestJson(`${prefix}/network-check`, { method: "POST" }));
    } catch (err) {
      setNetworkError(err instanceof Error ? err.message : String(err));
    } finally {
      setNetworkBusy(false);
    }
  }
  async function addWorkspace() {
    setAdding(true);
    setWorkspaceMessage("");
    try {
      const result = await requestJson(
        `${prefix}/workspace?path=${encodeURIComponent(path.trim())}`,
        { method: "POST" }
      );
      setWorkspaceMessage(result.message);
    } catch (err) {
      setWorkspaceMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }
  async function refresh() {
    setBusy(true);
    try {
      setData(await requestJson(`${prefix}/status`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  (0, import_react4.useEffect)(() => {
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const value = await requestJson(`${prefix}/status`);
        if (active) {
          setData(value);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
      if (active) timer = setTimeout(() => void poll(), 5e3);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
    "div",
    {
      className: "px-ui",
      style: { display: "grid", gap: 16, minWidth: 0, overflowWrap: "anywhere", paddingBottom: 20 },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { style: { margin: "0 0 8px" }, children: "\u8FD0\u884C\u4E0E\u5E2E\u52A9" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: { margin: 0, opacity: 0.7, lineHeight: 1.7 }, children: "\u67E5\u770B\u5F53\u524D\u8FDE\u63A5\u3001\u8FD0\u884C\u8BCA\u65AD\u6216\u914D\u7F6E\u5DE5\u4F5C\u533A\u3002" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { style: card, "aria-label": "\u5F53\u524D\u8FDE\u63A5", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { style: { marginTop: 0 }, children: "\u5F53\u524D\u8FDE\u63A5" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
            carrier === "desktop" ? "\u684C\u9762\u7A97\u53E3" : "\u6D4F\u89C8\u5668\u9875\u9762",
            " \xB7 ",
            data ? "\u539F\u751F DSH \u670D\u52A1" : "\u6B63\u5728\u8BC6\u522B\u670D\u52A1\u2026"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: { fontSize: 13, opacity: 0.75 }, children: "\u6B64\u670D\u52A1\u7531\u539F\u751F\u5BBF\u4E3B\uFF08\u684C\u9762\u5BA2\u6237\u7AEF\u6216 dsh web\uFF09\u6301\u6709\u3002\u91CD\u542F\u3001\u9000\u51FA\u4E0E\u5BA2\u6237\u7AEF\u66F4\u65B0\u8BF7\u4F7F\u7528\u5BBF\u4E3B\u81EA\u8EAB\u7684\u5165\u53E3\uFF1B\u672C\u6574\u5408\u5305\u4E0D\u63A7\u5236\u8FD9\u4E9B\u64CD\u4F5C\uFF0C\u4E5F\u4E0D\u636E\u6B64\u5224\u65AD\u5BBF\u4E3B\u72B6\u6001\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: { fontSize: 12, opacity: 0.65 }, children: "\u4F1A\u8BDD\u6807\u7B7E\u968F\u5F53\u524D\u670D\u52A1\u4FDD\u5B58\uFF1B\u672A\u4FDD\u5B58\u7684\u6279\u6CE8\u548C\u5B9A\u65F6\u8349\u7A3F\u53EA\u4FDD\u7559\u5728\u5F53\u524D\u7A97\u53E3\uFF0C\u5173\u95ED\u524D\u8BF7\u4FDD\u5B58\u3002" }),
          data?.activity.observedKnown ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
            "\u5F53\u524D\u53EF\u89C1\u6D3B\u52A8\uFF1A",
            data.activity.runningAgents,
            " \u4E2A\u8FD0\u884C\u4E2D\u7684 Agent \xB7 ",
            data.activity.runningJobs,
            " ",
            "\u4E2A\u540E\u53F0\u4EFB\u52A1 \xB7 ",
            data.activity.queuedInputs,
            " \u6761\u6392\u961F\u8F93\u5165\u3002",
            data.activity.openTerminals > 0 ? `\u5DF2\u68C0\u6D4B\u5230\u81F3\u5C11 ${data.activity.openTerminals} \u9879\u7EC8\u7AEF\u8D44\u6E90\u3002` : "",
            "\u7EC8\u7AEF\u53CA\u540E\u53F0\u4EFB\u52A1\u7684\u5B8C\u6574\u603B\u6570\u65E0\u6CD5\u786E\u8BA4\uFF0C\u8BF7\u5728\u5404\u4F1A\u8BDD\u4FA7\u680F\u67E5\u770B\uFF1B\u4E0D\u80FD\u636E\u6B64\u5224\u65AD\u670D\u52A1\u7A7A\u95F2\u3002"
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u4EFB\u52A1\u6216\u7EC8\u7AEF\u72B6\u6001\u5C1A\u672A\u786E\u8BA4\uFF1B\u8BF7\u68C0\u67E5\u8FD0\u884C\u8BCA\u65AD\u53CA\u4FA7\u680F\u517C\u5BB9\u6027\uFF0C\u4E0D\u80FD\u636E\u6B64\u5224\u65AD\u670D\u52A1\u7A7A\u95F2\u3002" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { style: card, open: data ? !data.credentialsFile : false, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("summary", { style: { cursor: "pointer" }, children: "\u9996\u6B21\u914D\u7F6E\u4E0E\u6DFB\u52A0\u5DE5\u4F5C\u533A" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { "aria-label": "\u5F00\u59CB\u4EFB\u52A1", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("ol", { style: { paddingLeft: 22, lineHeight: 1.9 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("li", { children: "\u5728\u8BBE\u7F6E\u7684\u6A21\u578B\u63D0\u4F9B\u5546\u4E2D\u914D\u7F6E\u6A21\u578B\u548C\u5BC6\u94A5\u3002" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("li", { children: "\u5173\u95ED\u8BBE\u7F6E\uFF0C\u5728\u4FA7\u680F\u6DFB\u52A0\u672C\u673A\u9879\u76EE\u6587\u4EF6\u5939\uFF0C\u518D\u65B0\u5EFA\u4F1A\u8BDD\u3002" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("li", { children: "\u9009\u62E9\u6807\u51C6\u6A21\u5F0F\u4E0E\u6A21\u578B\uFF0C\u63CF\u8FF0\u9700\u6C42\uFF1B\u6309\u63D0\u793A\u5BA1\u9605\u5DE5\u5177\u6743\u9650\u548C\u4FEE\u6539\u7ED3\u679C\u3002" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { htmlFor: "dsh-px-workspace", style: { fontSize: 13 }, children: "\u672C\u673A\u9879\u76EE\u6587\u4EF6\u5939" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0 16px" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                "input",
                {
                  id: "dsh-px-workspace",
                  value: path,
                  placeholder: "C:\\Projects\\demo",
                  onChange: (e) => setPath(e.target.value),
                  style: { ...button, minWidth: 0, flex: "1 1 240px", cursor: "text" }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { style: button, disabled: adding || !path.trim(), onClick: () => void addWorkspace(), children: adding ? "\u6DFB\u52A0\u4E2D\u2026" : "\u6DFB\u52A0\u5DE5\u4F5C\u533A" })
            ] }),
            workspaceMessage ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", style: { fontSize: 13 }, children: workspaceMessage }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: prompts.map((p) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
              "button",
              {
                style: button,
                onClick: () => {
                  void navigator.clipboard.writeText(p.text).then(() => setMessage(`\u5DF2\u590D\u5236\u201C${p.title}\u201D\uFF0C\u7C98\u8D34\u5230\u65B0\u4F1A\u8BDD\u5373\u53EF\u3002`)).catch(() => setMessage(`\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u590D\u5236\uFF1A${p.text}`));
                },
                children: [
                  "\u590D\u5236\uFF1A",
                  p.title
                ]
              },
              p.title
            )) }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: { fontSize: 12, opacity: 0.65, marginBottom: 0 }, children: "\u9996\u6B21\u9A8C\u8BC1\u5EFA\u8BAE\u4F7F\u7528\u7A7A\u6587\u4EF6\u5939\u3002\u6A21\u578B\u80FD\u5426\u8FDE\u63A5\u4EE5\u771F\u5B9E\u4EFB\u52A1\u7ED3\u679C\u4E3A\u51C6\u3002" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { style: card, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("summary", { style: { cursor: "pointer" }, children: "\u672C\u673A\u8FD0\u884C\u8BCA\u65AD" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { "aria-label": "\u672C\u673A\u8FD0\u884C\u68C0\u67E5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { children: "\u672C\u673A\u8FD0\u884C\u68C0\u67E5" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { style: button, disabled: busy, onClick: () => void refresh(), children: busy ? "\u68C0\u67E5\u4E2D\u2026" : "\u91CD\u65B0\u68C0\u67E5" })
            ] }),
            error ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { role: "alert", children: [
              "\u68C0\u67E5\u5931\u8D25\uFF1A",
              error,
              "\u3002\u53EF\u91CD\u65B0\u68C0\u67E5\uFF0C\u6216\u901A\u8FC7\u539F\u751F\u5BBF\u4E3B\u91CD\u542F\u670D\u52A1\u3002"
            ] }) : null,
            !data ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u672C\u673A\u72B6\u6001\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
                "dl",
                {
                  style: {
                    display: "grid",
                    gridTemplateColumns: "100px minmax(0,1fr)",
                    gap: "10px 12px",
                    fontSize: 13,
                    lineHeight: 1.6
                  },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "\u670D\u52A1\u6807\u8BC6" }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { style: { margin: 0 }, children: data.serviceId ?? "\u672A\u63D0\u4F9B" }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "Agent \u670D\u52A1" }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("dd", { style: { margin: 0 }, children: [
                      error ? "\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u4EE5\u4E0B\u4E3A\u4E0A\u6B21\u68C0\u67E5\u7ED3\u679C" : "\u5DF2\u8FDE\u63A5",
                      " \xB7 \u542F\u52A8\u4E8E",
                      " ",
                      new Date(data.startedAt).toLocaleTimeString()
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "\u5BBF\u4E3B\u7BA1\u7406" }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { style: { margin: 0 }, children: "\u7531\u539F\u751F\u5BBF\u4E3B\u8D1F\u8D23\uFF1B\u672C\u6574\u5408\u5305\u4E0D\u63D0\u4F9B\u91CD\u542F\u3001\u5B89\u88C5\u6216\u9000\u51FA\u64CD\u4F5C\uFF0C\u6B64\u5904\u4E0D\u663E\u793A\u5BBF\u4E3B\u8FDB\u7A0B\u72B6\u6001\u3002" }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "Node" }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("dd", { style: { margin: 0 }, children: [
                      data.node.version,
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("br", {}),
                      data.node.path
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "\u6570\u636E\u76EE\u5F55" }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("dd", { style: { margin: 0 }, children: [
                      data.home ?? "\u672A\u77E5",
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("br", {}),
                      data.writable ? "\u76EE\u5F55\u6743\u9650\u5141\u8BB8\u5199\u5165" : "\u76EE\u5F55\u4E0D\u53EF\u5199\uFF0C\u8BF7\u68C0\u67E5\u6743\u9650"
                    ] }),
                    data.tools.map((t) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "contents" }, children: [
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: t.name }),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { style: { margin: 0 }, children: t.path ? `\u5DF2\u627E\u5230\uFF1A${t.path}` : "PATH \u4E2D\u672A\u627E\u5230\uFF0C\u8BF7\u5B89\u88C5\u6216\u8C03\u6574\u672C\u673A\u73AF\u5883\u540E\u91CD\u542F" })
                    ] }, t.name)),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "\u6A21\u578B\u51ED\u636E" }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { style: { margin: 0 }, children: data.credentialsFile ? "\u5B58\u5728\u51ED\u636E\u6587\u4EF6\uFF0C\u8FDE\u63A5\u80FD\u529B\u9700\u5B9E\u9645\u8FD0\u884C\u4EFB\u52A1\u9A8C\u8BC1" : "\u672A\u53D1\u73B0\u51ED\u636E\u6587\u4EF6\uFF0C\u8BF7\u5728\u6A21\u578B\u8BBE\u7F6E\u4E2D\u914D\u7F6E\uFF08\u73AF\u5883\u53D8\u91CF\u914D\u7F6E\u4E5F\u53EF\u80FD\u53EF\u7528\uFF09" }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "\u7F51\u9875\u7F51\u7EDC" }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("dd", { style: { margin: 0 }, children: [
                      "\u4EE3\u7406\u4E0E\u7F51\u7EDC\u9650\u5236\u7531\u539F\u751F DSH \u7BA1\u7406\u3002\u53EF\u6267\u884C\u4E0B\u65B9\u7F51\u9875\u8BFB\u53D6\u68C0\u67E5\u3002",
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("br", {}),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("small", { children: "\u4EE3\u7406\u8BBE\u7F6E\u5728\u670D\u52A1\u542F\u52A8\u65F6\u751F\u6548\uFF1B\u7CFB\u7EDF\u4EE3\u7406\u6539\u53D8\u540E\u9700\u91CD\u542F\u670D\u52A1\u3002" })
                    ] })
                  ]
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { "aria-label": "\u7F51\u9875\u8BFB\u53D6\u68C0\u67E5", style: { margin: "16px 0" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                  "button",
                  {
                    style: button,
                    disabled: networkBusy || Boolean(error),
                    onClick: () => void checkNetwork(),
                    children: networkBusy ? "\u6B63\u5728\u8BFB\u53D6\u516C\u5F00\u6587\u6863\u2026" : "\u68C0\u67E5\u7F51\u9875\u8BFB\u53D6"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: { fontSize: 12, opacity: 0.7 }, children: "\u4F7F\u7528 Agent \u540C\u4E00\u7F51\u9875\u670D\u52A1\u8BFB\u53D6 Node.js \u4E0E TypeScript \u5B98\u65B9\u6587\u6863\uFF0C\u4E0D\u8C03\u7528\u6A21\u578B\u3002" }),
                networkError ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { role: "alert", children: [
                  networkError,
                  networkCheck ? " \u4E0B\u65B9\u4E3A\u4E0A\u6B21\u68C0\u67E5\u7ED3\u679C\u3002" : ""
                ] }) : null,
                networkCheck ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { role: "status", children: [
                  networkCheck.checks.map((check) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { marginTop: 8 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: check.ok ? "\u53EF\u8BFB\u53D6" : "\u672A\u901A\u8FC7" }),
                    " \xB7 ",
                    check.message,
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("code", { children: check.url }) }),
                    check.ok ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("small", { children: [
                      "HTTP ",
                      check.status,
                      " \xB7 \u5DF2\u53D6\u5F97 ",
                      check.chars,
                      " \u5B57\u7B26",
                      check.truncated ? "\uFF08\u670D\u52A1\u5DF2\u622A\u65AD\uFF09" : ""
                    ] }) : null
                  ] }, check.url)),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("small", { children: [
                    "\u68C0\u67E5\u4E8E ",
                    new Date(networkCheck.checkedAt).toLocaleString()
                  ] })
                ] }) : null
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { style: { fontSize: 12, opacity: 0.6 }, children: [
                "\u68C0\u67E5\u65F6\u95F4\uFF1A",
                new Date(data.checkedAt).toLocaleString(),
                " \xB7 \u5DE5\u5177\u8DEF\u5F84\u68C0\u67E5\u4E0D\u4EE3\u8868\u547D\u4EE4\u5DF2\u6267\u884C\u6210\u529F\u3002"
              ] })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { style: card, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("summary", { style: { cursor: "pointer" }, children: "\u9AD8\u7EA7\uFF1A\u63D2\u4EF6\u8BCA\u65AD\u6E05\u5355" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { "aria-label": "\u63D2\u4EF6\u6E05\u5355", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { style: { marginTop: 0 }, children: "\u5F53\u524D Profile \u7684\u63D2\u4EF6" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "\u5F53\u524D\u9875\u9762\u5B9E\u9645\u53EF\u7528\u670D\u52A1" }),
            Object.entries(dependencyLabels).map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
              activated[id] ? "\u53EF\u7528" : "\u672A\u542F\u7528",
              " \xB7 ",
              label
            ] }, id)),
            Object.keys(dependencyLabels).some((id) => !activated[id]) ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", children: "\u672A\u542F\u7528\u7684\u670D\u52A1\u4F1A\u4F7F\u5BF9\u5E94\u529F\u80FD\u4E0D\u53EF\u7528\u3002\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u68C0\u67E5\u662F\u5426\u542F\u7528\u76F8\u5173\u63D2\u4EF6\uFF0C\u6062\u590D\u540E\u91CD\u542F\u670D\u52A1\uFF1B\u539F\u751F\u4F1A\u8BDD\u529F\u80FD\u53EF\u7EE7\u7EED\u4F7F\u7528\u3002\u7981\u7528\u4FA7\u8FB9\u5361\u7247\u4F1A\u540C\u65F6\u505C\u7528\u4F9D\u8D56\u5B83\u7684\u591A\u4E2A\u9762\u677F\u3002" }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: { fontSize: 12, opacity: 0.7 }, children: "\u6CBF\u7528 DSH \u63D2\u4EF6\u5E02\u573A\u7BA1\u7406\u63D2\u4EF6\u3002\u5B89\u88C5\u6216\u66F4\u6539\u7EC4\u5408\u5305\u540E\u91CD\u542F\u670D\u52A1\u751F\u6548\uFF1B\u8FD9\u91CC\u663E\u793A\u5B89\u88C5\u4E0E\u6E05\u5355\u72B6\u6001\uFF0C\u4E0D\u4EE3\u8868\u6BCF\u4E2A\u63D2\u4EF6\u8FD0\u884C\u6B63\u5E38\u3002" }),
            data?.profileError ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { role: "alert", children: [
              "\u65E0\u6CD5\u8BFB\u53D6\u63D2\u4EF6\u6E05\u5355\uFF1A",
              data.profileError
            ] }) : null,
            data?.plugins.map((p) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { padding: "10px 0", borderTop: "1px solid #8883", fontSize: 13 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: p.name }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { opacity: 0.7, marginTop: 4 }, children: [
                p.version ?? "\u672A\u5B89\u88C5\u6216\u5305\u4E0D\u53EF\u8BFB",
                " \xB7 ",
                p.enabled ? "\u5DF2\u52A0\u5165\u7EC4\u5408\u5305" : "\u672A\u52A0\u5165\u7EC4\u5408\u5305"
              ] })
            ] }, p.name)),
            data && !data.profileError && data.plugins.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u6B64 Profile \u6682\u65E0\u989D\u5916\u63D2\u4EF6\u3002" }) : null
          ] })
        ] }),
        message ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", style: { ...card, margin: 0 }, children: message }) : null
      ]
    }
  );
}
function apply(ctx) {
  installUiStyles(ctx);
  installHtmlPreview(ctx);
  installContextModelSelect(ctx);
  const capabilities = createCapabilities({});
  for (const name of Object.keys(dependencyLabels))
    ctx.inject([name], (host) => {
      capabilities.set({ [name]: true });
      host.effect(() => () => capabilities.set({ [name]: false }), `workbench: ${name} activation`);
    });
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      { name: "settings.section", id: "dsh-px-workbench", order: 110, label: "\u8FD0\u884C\u4E0E\u5E2E\u52A9" },
      () => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Workbench, { capabilities })
    )
  );
}

		return module.exports;
	}
});
