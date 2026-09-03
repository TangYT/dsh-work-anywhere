window.__ModuleLoader__.load({
	id: "dsh-work-anywhere",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
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
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
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

// ../dsh-work-anywhere/node_modules/qrcode/lib/can-promise.js
var require_can_promise = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/can-promise.js"(exports, module2) {
    module2.exports = function() {
      return typeof Promise === "function" && Promise.prototype && Promise.prototype.then;
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/utils.js
var require_utils = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/utils.js"(exports) {
    var toSJISFunction;
    var CODEWORDS_COUNT = [
      0,
      // Not used
      26,
      44,
      70,
      100,
      134,
      172,
      196,
      242,
      292,
      346,
      404,
      466,
      532,
      581,
      655,
      733,
      815,
      901,
      991,
      1085,
      1156,
      1258,
      1364,
      1474,
      1588,
      1706,
      1828,
      1921,
      2051,
      2185,
      2323,
      2465,
      2611,
      2761,
      2876,
      3034,
      3196,
      3362,
      3532,
      3706
    ];
    exports.getSymbolSize = function getSymbolSize(version) {
      if (!version) throw new Error('"version" cannot be null or undefined');
      if (version < 1 || version > 40) throw new Error('"version" should be in range from 1 to 40');
      return version * 4 + 17;
    };
    exports.getSymbolTotalCodewords = function getSymbolTotalCodewords(version) {
      return CODEWORDS_COUNT[version];
    };
    exports.getBCHDigit = function(data) {
      let digit = 0;
      while (data !== 0) {
        digit++;
        data >>>= 1;
      }
      return digit;
    };
    exports.setToSJISFunction = function setToSJISFunction(f) {
      if (typeof f !== "function") {
        throw new Error('"toSJISFunc" is not a valid function.');
      }
      toSJISFunction = f;
    };
    exports.isKanjiModeEnabled = function() {
      return typeof toSJISFunction !== "undefined";
    };
    exports.toSJIS = function toSJIS(kanji) {
      return toSJISFunction(kanji);
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/error-correction-level.js
var require_error_correction_level = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/error-correction-level.js"(exports) {
    exports.L = { bit: 1 };
    exports.M = { bit: 0 };
    exports.Q = { bit: 3 };
    exports.H = { bit: 2 };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "l":
        case "low":
          return exports.L;
        case "m":
        case "medium":
          return exports.M;
        case "q":
        case "quartile":
          return exports.Q;
        case "h":
        case "high":
          return exports.H;
        default:
          throw new Error("Unknown EC Level: " + string);
      }
    }
    exports.isValid = function isValid(level) {
      return level && typeof level.bit !== "undefined" && level.bit >= 0 && level.bit < 4;
    };
    exports.from = function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/bit-buffer.js
var require_bit_buffer = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/bit-buffer.js"(exports, module2) {
    function BitBuffer() {
      this.buffer = [];
      this.length = 0;
    }
    BitBuffer.prototype = {
      get: function(index) {
        const bufIndex = Math.floor(index / 8);
        return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) === 1;
      },
      put: function(num, length) {
        for (let i = 0; i < length; i++) {
          this.putBit((num >>> length - i - 1 & 1) === 1);
        }
      },
      getLengthInBits: function() {
        return this.length;
      },
      putBit: function(bit) {
        const bufIndex = Math.floor(this.length / 8);
        if (this.buffer.length <= bufIndex) {
          this.buffer.push(0);
        }
        if (bit) {
          this.buffer[bufIndex] |= 128 >>> this.length % 8;
        }
        this.length++;
      }
    };
    module2.exports = BitBuffer;
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/bit-matrix.js
var require_bit_matrix = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/bit-matrix.js"(exports, module2) {
    function BitMatrix(size) {
      if (!size || size < 1) {
        throw new Error("BitMatrix size must be defined and greater than 0");
      }
      this.size = size;
      this.data = new Uint8Array(size * size);
      this.reservedBit = new Uint8Array(size * size);
    }
    BitMatrix.prototype.set = function(row, col, value, reserved) {
      const index = row * this.size + col;
      this.data[index] = value;
      if (reserved) this.reservedBit[index] = true;
    };
    BitMatrix.prototype.get = function(row, col) {
      return this.data[row * this.size + col];
    };
    BitMatrix.prototype.xor = function(row, col, value) {
      this.data[row * this.size + col] ^= value;
    };
    BitMatrix.prototype.isReserved = function(row, col) {
      return this.reservedBit[row * this.size + col];
    };
    module2.exports = BitMatrix;
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/alignment-pattern.js
var require_alignment_pattern = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/alignment-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    exports.getRowColCoords = function getRowColCoords(version) {
      if (version === 1) return [];
      const posCount = Math.floor(version / 7) + 2;
      const size = getSymbolSize(version);
      const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
      const positions = [size - 7];
      for (let i = 1; i < posCount - 1; i++) {
        positions[i] = positions[i - 1] - intervals;
      }
      positions.push(6);
      return positions.reverse();
    };
    exports.getPositions = function getPositions(version) {
      const coords = [];
      const pos = exports.getRowColCoords(version);
      const posLength = pos.length;
      for (let i = 0; i < posLength; i++) {
        for (let j = 0; j < posLength; j++) {
          if (i === 0 && j === 0 || // top-left
          i === 0 && j === posLength - 1 || // bottom-left
          i === posLength - 1 && j === 0) {
            continue;
          }
          coords.push([pos[i], pos[j]]);
        }
      }
      return coords;
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/finder-pattern.js
var require_finder_pattern = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/finder-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    var FINDER_PATTERN_SIZE = 7;
    exports.getPositions = function getPositions(version) {
      const size = getSymbolSize(version);
      return [
        // top-left
        [0, 0],
        // top-right
        [size - FINDER_PATTERN_SIZE, 0],
        // bottom-left
        [0, size - FINDER_PATTERN_SIZE]
      ];
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/mask-pattern.js
var require_mask_pattern = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/mask-pattern.js"(exports) {
    exports.Patterns = {
      PATTERN000: 0,
      PATTERN001: 1,
      PATTERN010: 2,
      PATTERN011: 3,
      PATTERN100: 4,
      PATTERN101: 5,
      PATTERN110: 6,
      PATTERN111: 7
    };
    var PenaltyScores = {
      N1: 3,
      N2: 3,
      N3: 40,
      N4: 10
    };
    exports.isValid = function isValid(mask) {
      return mask != null && mask !== "" && !isNaN(mask) && mask >= 0 && mask <= 7;
    };
    exports.from = function from(value) {
      return exports.isValid(value) ? parseInt(value, 10) : void 0;
    };
    exports.getPenaltyN1 = function getPenaltyN1(data) {
      const size = data.size;
      let points = 0;
      let sameCountCol = 0;
      let sameCountRow = 0;
      let lastCol = null;
      let lastRow = null;
      for (let row = 0; row < size; row++) {
        sameCountCol = sameCountRow = 0;
        lastCol = lastRow = null;
        for (let col = 0; col < size; col++) {
          let module3 = data.get(row, col);
          if (module3 === lastCol) {
            sameCountCol++;
          } else {
            if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
            lastCol = module3;
            sameCountCol = 1;
          }
          module3 = data.get(col, row);
          if (module3 === lastRow) {
            sameCountRow++;
          } else {
            if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
            lastRow = module3;
            sameCountRow = 1;
          }
        }
        if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
        if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
      }
      return points;
    };
    exports.getPenaltyN2 = function getPenaltyN2(data) {
      const size = data.size;
      let points = 0;
      for (let row = 0; row < size - 1; row++) {
        for (let col = 0; col < size - 1; col++) {
          const last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
          if (last === 4 || last === 0) points++;
        }
      }
      return points * PenaltyScores.N2;
    };
    exports.getPenaltyN3 = function getPenaltyN3(data) {
      const size = data.size;
      let points = 0;
      let bitsCol = 0;
      let bitsRow = 0;
      for (let row = 0; row < size; row++) {
        bitsCol = bitsRow = 0;
        for (let col = 0; col < size; col++) {
          bitsCol = bitsCol << 1 & 2047 | data.get(row, col);
          if (col >= 10 && (bitsCol === 1488 || bitsCol === 93)) points++;
          bitsRow = bitsRow << 1 & 2047 | data.get(col, row);
          if (col >= 10 && (bitsRow === 1488 || bitsRow === 93)) points++;
        }
      }
      return points * PenaltyScores.N3;
    };
    exports.getPenaltyN4 = function getPenaltyN4(data) {
      let darkCount = 0;
      const modulesCount = data.data.length;
      for (let i = 0; i < modulesCount; i++) darkCount += data.data[i];
      const k = Math.abs(Math.ceil(darkCount * 100 / modulesCount / 5) - 10);
      return k * PenaltyScores.N4;
    };
    function getMaskAt(maskPattern, i, j) {
      switch (maskPattern) {
        case exports.Patterns.PATTERN000:
          return (i + j) % 2 === 0;
        case exports.Patterns.PATTERN001:
          return i % 2 === 0;
        case exports.Patterns.PATTERN010:
          return j % 3 === 0;
        case exports.Patterns.PATTERN011:
          return (i + j) % 3 === 0;
        case exports.Patterns.PATTERN100:
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case exports.Patterns.PATTERN101:
          return i * j % 2 + i * j % 3 === 0;
        case exports.Patterns.PATTERN110:
          return (i * j % 2 + i * j % 3) % 2 === 0;
        case exports.Patterns.PATTERN111:
          return (i * j % 3 + (i + j) % 2) % 2 === 0;
        default:
          throw new Error("bad maskPattern:" + maskPattern);
      }
    }
    exports.applyMask = function applyMask(pattern, data) {
      const size = data.size;
      for (let col = 0; col < size; col++) {
        for (let row = 0; row < size; row++) {
          if (data.isReserved(row, col)) continue;
          data.xor(row, col, getMaskAt(pattern, row, col));
        }
      }
    };
    exports.getBestMask = function getBestMask(data, setupFormatFunc) {
      const numPatterns = Object.keys(exports.Patterns).length;
      let bestPattern = 0;
      let lowerPenalty = Infinity;
      for (let p = 0; p < numPatterns; p++) {
        setupFormatFunc(p);
        exports.applyMask(p, data);
        const penalty = exports.getPenaltyN1(data) + exports.getPenaltyN2(data) + exports.getPenaltyN3(data) + exports.getPenaltyN4(data);
        exports.applyMask(p, data);
        if (penalty < lowerPenalty) {
          lowerPenalty = penalty;
          bestPattern = p;
        }
      }
      return bestPattern;
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/error-correction-code.js
var require_error_correction_code = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/error-correction-code.js"(exports) {
    var ECLevel = require_error_correction_level();
    var EC_BLOCKS_TABLE = [
      // L  M  Q  H
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      2,
      1,
      2,
      2,
      4,
      1,
      2,
      4,
      4,
      2,
      4,
      4,
      4,
      2,
      4,
      6,
      5,
      2,
      4,
      6,
      6,
      2,
      5,
      8,
      8,
      4,
      5,
      8,
      8,
      4,
      5,
      8,
      11,
      4,
      8,
      10,
      11,
      4,
      9,
      12,
      16,
      4,
      9,
      16,
      16,
      6,
      10,
      12,
      18,
      6,
      10,
      17,
      16,
      6,
      11,
      16,
      19,
      6,
      13,
      18,
      21,
      7,
      14,
      21,
      25,
      8,
      16,
      20,
      25,
      8,
      17,
      23,
      25,
      9,
      17,
      23,
      34,
      9,
      18,
      25,
      30,
      10,
      20,
      27,
      32,
      12,
      21,
      29,
      35,
      12,
      23,
      34,
      37,
      12,
      25,
      34,
      40,
      13,
      26,
      35,
      42,
      14,
      28,
      38,
      45,
      15,
      29,
      40,
      48,
      16,
      31,
      43,
      51,
      17,
      33,
      45,
      54,
      18,
      35,
      48,
      57,
      19,
      37,
      51,
      60,
      19,
      38,
      53,
      63,
      20,
      40,
      56,
      66,
      21,
      43,
      59,
      70,
      22,
      45,
      62,
      74,
      24,
      47,
      65,
      77,
      25,
      49,
      68,
      81
    ];
    var EC_CODEWORDS_TABLE = [
      // L  M  Q  H
      7,
      10,
      13,
      17,
      10,
      16,
      22,
      28,
      15,
      26,
      36,
      44,
      20,
      36,
      52,
      64,
      26,
      48,
      72,
      88,
      36,
      64,
      96,
      112,
      40,
      72,
      108,
      130,
      48,
      88,
      132,
      156,
      60,
      110,
      160,
      192,
      72,
      130,
      192,
      224,
      80,
      150,
      224,
      264,
      96,
      176,
      260,
      308,
      104,
      198,
      288,
      352,
      120,
      216,
      320,
      384,
      132,
      240,
      360,
      432,
      144,
      280,
      408,
      480,
      168,
      308,
      448,
      532,
      180,
      338,
      504,
      588,
      196,
      364,
      546,
      650,
      224,
      416,
      600,
      700,
      224,
      442,
      644,
      750,
      252,
      476,
      690,
      816,
      270,
      504,
      750,
      900,
      300,
      560,
      810,
      960,
      312,
      588,
      870,
      1050,
      336,
      644,
      952,
      1110,
      360,
      700,
      1020,
      1200,
      390,
      728,
      1050,
      1260,
      420,
      784,
      1140,
      1350,
      450,
      812,
      1200,
      1440,
      480,
      868,
      1290,
      1530,
      510,
      924,
      1350,
      1620,
      540,
      980,
      1440,
      1710,
      570,
      1036,
      1530,
      1800,
      570,
      1064,
      1590,
      1890,
      600,
      1120,
      1680,
      1980,
      630,
      1204,
      1770,
      2100,
      660,
      1260,
      1860,
      2220,
      720,
      1316,
      1950,
      2310,
      750,
      1372,
      2040,
      2430
    ];
    exports.getBlocksCount = function getBlocksCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
    exports.getTotalCodewordsCount = function getTotalCodewordsCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/galois-field.js
var require_galois_field = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/galois-field.js"(exports) {
    var EXP_TABLE = new Uint8Array(512);
    var LOG_TABLE = new Uint8Array(256);
    (function initTables() {
      let x = 1;
      for (let i = 0; i < 255; i++) {
        EXP_TABLE[i] = x;
        LOG_TABLE[x] = i;
        x <<= 1;
        if (x & 256) {
          x ^= 285;
        }
      }
      for (let i = 255; i < 512; i++) {
        EXP_TABLE[i] = EXP_TABLE[i - 255];
      }
    })();
    exports.log = function log(n) {
      if (n < 1) throw new Error("log(" + n + ")");
      return LOG_TABLE[n];
    };
    exports.exp = function exp(n) {
      return EXP_TABLE[n];
    };
    exports.mul = function mul(x, y) {
      if (x === 0 || y === 0) return 0;
      return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/polynomial.js
var require_polynomial = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/polynomial.js"(exports) {
    var GF = require_galois_field();
    exports.mul = function mul(p1, p2) {
      const coeff = new Uint8Array(p1.length + p2.length - 1);
      for (let i = 0; i < p1.length; i++) {
        for (let j = 0; j < p2.length; j++) {
          coeff[i + j] ^= GF.mul(p1[i], p2[j]);
        }
      }
      return coeff;
    };
    exports.mod = function mod(divident, divisor) {
      let result = new Uint8Array(divident);
      while (result.length - divisor.length >= 0) {
        const coeff = result[0];
        for (let i = 0; i < divisor.length; i++) {
          result[i] ^= GF.mul(divisor[i], coeff);
        }
        let offset = 0;
        while (offset < result.length && result[offset] === 0) offset++;
        result = result.slice(offset);
      }
      return result;
    };
    exports.generateECPolynomial = function generateECPolynomial(degree) {
      let poly = new Uint8Array([1]);
      for (let i = 0; i < degree; i++) {
        poly = exports.mul(poly, new Uint8Array([1, GF.exp(i)]));
      }
      return poly;
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/reed-solomon-encoder.js
var require_reed_solomon_encoder = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/reed-solomon-encoder.js"(exports, module2) {
    var Polynomial = require_polynomial();
    function ReedSolomonEncoder(degree) {
      this.genPoly = void 0;
      this.degree = degree;
      if (this.degree) this.initialize(this.degree);
    }
    ReedSolomonEncoder.prototype.initialize = function initialize(degree) {
      this.degree = degree;
      this.genPoly = Polynomial.generateECPolynomial(this.degree);
    };
    ReedSolomonEncoder.prototype.encode = function encode(data) {
      if (!this.genPoly) {
        throw new Error("Encoder not initialized");
      }
      const paddedData = new Uint8Array(data.length + this.degree);
      paddedData.set(data);
      const remainder = Polynomial.mod(paddedData, this.genPoly);
      const start = this.degree - remainder.length;
      if (start > 0) {
        const buff = new Uint8Array(this.degree);
        buff.set(remainder, start);
        return buff;
      }
      return remainder;
    };
    module2.exports = ReedSolomonEncoder;
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/version-check.js
var require_version_check = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/version-check.js"(exports) {
    exports.isValid = function isValid(version) {
      return !isNaN(version) && version >= 1 && version <= 40;
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/regex.js
var require_regex = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/regex.js"(exports) {
    var numeric = "[0-9]+";
    var alphanumeric = "[A-Z $%*+\\-./:]+";
    var kanji = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
    kanji = kanji.replace(/u/g, "\\u");
    var byte = "(?:(?![A-Z0-9 $%*+\\-./:]|" + kanji + ")(?:.|[\r\n]))+";
    exports.KANJI = new RegExp(kanji, "g");
    exports.BYTE_KANJI = new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g");
    exports.BYTE = new RegExp(byte, "g");
    exports.NUMERIC = new RegExp(numeric, "g");
    exports.ALPHANUMERIC = new RegExp(alphanumeric, "g");
    var TEST_KANJI = new RegExp("^" + kanji + "$");
    var TEST_NUMERIC = new RegExp("^" + numeric + "$");
    var TEST_ALPHANUMERIC = new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
    exports.testKanji = function testKanji(str) {
      return TEST_KANJI.test(str);
    };
    exports.testNumeric = function testNumeric(str) {
      return TEST_NUMERIC.test(str);
    };
    exports.testAlphanumeric = function testAlphanumeric(str) {
      return TEST_ALPHANUMERIC.test(str);
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/mode.js
var require_mode = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/mode.js"(exports) {
    var VersionCheck = require_version_check();
    var Regex = require_regex();
    exports.NUMERIC = {
      id: "Numeric",
      bit: 1 << 0,
      ccBits: [10, 12, 14]
    };
    exports.ALPHANUMERIC = {
      id: "Alphanumeric",
      bit: 1 << 1,
      ccBits: [9, 11, 13]
    };
    exports.BYTE = {
      id: "Byte",
      bit: 1 << 2,
      ccBits: [8, 16, 16]
    };
    exports.KANJI = {
      id: "Kanji",
      bit: 1 << 3,
      ccBits: [8, 10, 12]
    };
    exports.MIXED = {
      bit: -1
    };
    exports.getCharCountIndicator = function getCharCountIndicator(mode, version) {
      if (!mode.ccBits) throw new Error("Invalid mode: " + mode);
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid version: " + version);
      }
      if (version >= 1 && version < 10) return mode.ccBits[0];
      else if (version < 27) return mode.ccBits[1];
      return mode.ccBits[2];
    };
    exports.getBestModeForData = function getBestModeForData(dataStr) {
      if (Regex.testNumeric(dataStr)) return exports.NUMERIC;
      else if (Regex.testAlphanumeric(dataStr)) return exports.ALPHANUMERIC;
      else if (Regex.testKanji(dataStr)) return exports.KANJI;
      else return exports.BYTE;
    };
    exports.toString = function toString(mode) {
      if (mode && mode.id) return mode.id;
      throw new Error("Invalid mode");
    };
    exports.isValid = function isValid(mode) {
      return mode && mode.bit && mode.ccBits;
    };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "numeric":
          return exports.NUMERIC;
        case "alphanumeric":
          return exports.ALPHANUMERIC;
        case "kanji":
          return exports.KANJI;
        case "byte":
          return exports.BYTE;
        default:
          throw new Error("Unknown mode: " + string);
      }
    }
    exports.from = function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/version.js
var require_version = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/version.js"(exports) {
    var Utils = require_utils();
    var ECCode = require_error_correction_code();
    var ECLevel = require_error_correction_level();
    var Mode = require_mode();
    var VersionCheck = require_version_check();
    var G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
    var G18_BCH = Utils.getBCHDigit(G18);
    function getBestVersionForDataLength(mode, length, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, mode)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    function getReservedBitsCount(mode, version) {
      return Mode.getCharCountIndicator(mode, version) + 4;
    }
    function getTotalBitsFromDataArray(segments, version) {
      let totalBits = 0;
      segments.forEach(function(data) {
        const reservedBits = getReservedBitsCount(data.mode, version);
        totalBits += reservedBits + data.getBitsLength();
      });
      return totalBits;
    }
    function getBestVersionForMixedData(segments, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        const length = getTotalBitsFromDataArray(segments, currentVersion);
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, Mode.MIXED)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    exports.from = function from(value, defaultValue) {
      if (VersionCheck.isValid(value)) {
        return parseInt(value, 10);
      }
      return defaultValue;
    };
    exports.getCapacity = function getCapacity(version, errorCorrectionLevel, mode) {
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid QR Code version");
      }
      if (typeof mode === "undefined") mode = Mode.BYTE;
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (mode === Mode.MIXED) return dataTotalCodewordsBits;
      const usableBits = dataTotalCodewordsBits - getReservedBitsCount(mode, version);
      switch (mode) {
        case Mode.NUMERIC:
          return Math.floor(usableBits / 10 * 3);
        case Mode.ALPHANUMERIC:
          return Math.floor(usableBits / 11 * 2);
        case Mode.KANJI:
          return Math.floor(usableBits / 13);
        case Mode.BYTE:
        default:
          return Math.floor(usableBits / 8);
      }
    };
    exports.getBestVersionForData = function getBestVersionForData(data, errorCorrectionLevel) {
      let seg;
      const ecl = ECLevel.from(errorCorrectionLevel, ECLevel.M);
      if (Array.isArray(data)) {
        if (data.length > 1) {
          return getBestVersionForMixedData(data, ecl);
        }
        if (data.length === 0) {
          return 1;
        }
        seg = data[0];
      } else {
        seg = data;
      }
      return getBestVersionForDataLength(seg.mode, seg.getLength(), ecl);
    };
    exports.getEncodedBits = function getEncodedBits(version) {
      if (!VersionCheck.isValid(version) || version < 7) {
        throw new Error("Invalid QR Code version");
      }
      let d = version << 12;
      while (Utils.getBCHDigit(d) - G18_BCH >= 0) {
        d ^= G18 << Utils.getBCHDigit(d) - G18_BCH;
      }
      return version << 12 | d;
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/format-info.js
var require_format_info = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/format-info.js"(exports) {
    var Utils = require_utils();
    var G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
    var G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
    var G15_BCH = Utils.getBCHDigit(G15);
    exports.getEncodedBits = function getEncodedBits(errorCorrectionLevel, mask) {
      const data = errorCorrectionLevel.bit << 3 | mask;
      let d = data << 10;
      while (Utils.getBCHDigit(d) - G15_BCH >= 0) {
        d ^= G15 << Utils.getBCHDigit(d) - G15_BCH;
      }
      return (data << 10 | d) ^ G15_MASK;
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/numeric-data.js
var require_numeric_data = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/numeric-data.js"(exports, module2) {
    var Mode = require_mode();
    function NumericData(data) {
      this.mode = Mode.NUMERIC;
      this.data = data.toString();
    }
    NumericData.getBitsLength = function getBitsLength(length) {
      return 10 * Math.floor(length / 3) + (length % 3 ? length % 3 * 3 + 1 : 0);
    };
    NumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    NumericData.prototype.getBitsLength = function getBitsLength() {
      return NumericData.getBitsLength(this.data.length);
    };
    NumericData.prototype.write = function write(bitBuffer) {
      let i, group, value;
      for (i = 0; i + 3 <= this.data.length; i += 3) {
        group = this.data.substr(i, 3);
        value = parseInt(group, 10);
        bitBuffer.put(value, 10);
      }
      const remainingNum = this.data.length - i;
      if (remainingNum > 0) {
        group = this.data.substr(i);
        value = parseInt(group, 10);
        bitBuffer.put(value, remainingNum * 3 + 1);
      }
    };
    module2.exports = NumericData;
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/alphanumeric-data.js
var require_alphanumeric_data = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/alphanumeric-data.js"(exports, module2) {
    var Mode = require_mode();
    var ALPHA_NUM_CHARS = [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "W",
      "X",
      "Y",
      "Z",
      " ",
      "$",
      "%",
      "*",
      "+",
      "-",
      ".",
      "/",
      ":"
    ];
    function AlphanumericData(data) {
      this.mode = Mode.ALPHANUMERIC;
      this.data = data;
    }
    AlphanumericData.getBitsLength = function getBitsLength(length) {
      return 11 * Math.floor(length / 2) + 6 * (length % 2);
    };
    AlphanumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    AlphanumericData.prototype.getBitsLength = function getBitsLength() {
      return AlphanumericData.getBitsLength(this.data.length);
    };
    AlphanumericData.prototype.write = function write(bitBuffer) {
      let i;
      for (i = 0; i + 2 <= this.data.length; i += 2) {
        let value = ALPHA_NUM_CHARS.indexOf(this.data[i]) * 45;
        value += ALPHA_NUM_CHARS.indexOf(this.data[i + 1]);
        bitBuffer.put(value, 11);
      }
      if (this.data.length % 2) {
        bitBuffer.put(ALPHA_NUM_CHARS.indexOf(this.data[i]), 6);
      }
    };
    module2.exports = AlphanumericData;
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/byte-data.js
var require_byte_data = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/byte-data.js"(exports, module2) {
    var Mode = require_mode();
    function ByteData(data) {
      this.mode = Mode.BYTE;
      if (typeof data === "string") {
        this.data = new TextEncoder().encode(data);
      } else {
        this.data = new Uint8Array(data);
      }
    }
    ByteData.getBitsLength = function getBitsLength(length) {
      return length * 8;
    };
    ByteData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    ByteData.prototype.getBitsLength = function getBitsLength() {
      return ByteData.getBitsLength(this.data.length);
    };
    ByteData.prototype.write = function(bitBuffer) {
      for (let i = 0, l = this.data.length; i < l; i++) {
        bitBuffer.put(this.data[i], 8);
      }
    };
    module2.exports = ByteData;
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/kanji-data.js
var require_kanji_data = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/kanji-data.js"(exports, module2) {
    var Mode = require_mode();
    var Utils = require_utils();
    function KanjiData(data) {
      this.mode = Mode.KANJI;
      this.data = data;
    }
    KanjiData.getBitsLength = function getBitsLength(length) {
      return length * 13;
    };
    KanjiData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    KanjiData.prototype.getBitsLength = function getBitsLength() {
      return KanjiData.getBitsLength(this.data.length);
    };
    KanjiData.prototype.write = function(bitBuffer) {
      let i;
      for (i = 0; i < this.data.length; i++) {
        let value = Utils.toSJIS(this.data[i]);
        if (value >= 33088 && value <= 40956) {
          value -= 33088;
        } else if (value >= 57408 && value <= 60351) {
          value -= 49472;
        } else {
          throw new Error(
            "Invalid SJIS character: " + this.data[i] + "\nMake sure your charset is UTF-8"
          );
        }
        value = (value >>> 8 & 255) * 192 + (value & 255);
        bitBuffer.put(value, 13);
      }
    };
    module2.exports = KanjiData;
  }
});

// ../dsh-work-anywhere/node_modules/dijkstrajs/dijkstra.js
var require_dijkstra = __commonJS({
  "../dsh-work-anywhere/node_modules/dijkstrajs/dijkstra.js"(exports, module2) {
    "use strict";
    var dijkstra = {
      single_source_shortest_paths: function(graph, s, d) {
        var predecessors = {};
        var costs = {};
        costs[s] = 0;
        var open = dijkstra.PriorityQueue.make();
        open.push(s, 0);
        var closest, u, v, cost_of_s_to_u, adjacent_nodes, cost_of_e, cost_of_s_to_u_plus_cost_of_e, cost_of_s_to_v, first_visit;
        while (!open.empty()) {
          closest = open.pop();
          u = closest.value;
          cost_of_s_to_u = closest.cost;
          adjacent_nodes = graph[u] || {};
          for (v in adjacent_nodes) {
            if (adjacent_nodes.hasOwnProperty(v)) {
              cost_of_e = adjacent_nodes[v];
              cost_of_s_to_u_plus_cost_of_e = cost_of_s_to_u + cost_of_e;
              cost_of_s_to_v = costs[v];
              first_visit = typeof costs[v] === "undefined";
              if (first_visit || cost_of_s_to_v > cost_of_s_to_u_plus_cost_of_e) {
                costs[v] = cost_of_s_to_u_plus_cost_of_e;
                open.push(v, cost_of_s_to_u_plus_cost_of_e);
                predecessors[v] = u;
              }
            }
          }
        }
        if (typeof d !== "undefined" && typeof costs[d] === "undefined") {
          var msg = ["Could not find a path from ", s, " to ", d, "."].join("");
          throw new Error(msg);
        }
        return predecessors;
      },
      extract_shortest_path_from_predecessor_list: function(predecessors, d) {
        var nodes = [];
        var u = d;
        var predecessor;
        while (u) {
          nodes.push(u);
          predecessor = predecessors[u];
          u = predecessors[u];
        }
        nodes.reverse();
        return nodes;
      },
      find_path: function(graph, s, d) {
        var predecessors = dijkstra.single_source_shortest_paths(graph, s, d);
        return dijkstra.extract_shortest_path_from_predecessor_list(
          predecessors,
          d
        );
      },
      /**
       * A very naive priority queue implementation.
       */
      PriorityQueue: {
        make: function(opts) {
          var T = dijkstra.PriorityQueue, t = {}, key;
          opts = opts || {};
          for (key in T) {
            if (T.hasOwnProperty(key)) {
              t[key] = T[key];
            }
          }
          t.queue = [];
          t.sorter = opts.sorter || T.default_sorter;
          return t;
        },
        default_sorter: function(a, b) {
          return a.cost - b.cost;
        },
        /**
         * Add a new item to the queue and ensure the highest priority element
         * is at the front of the queue.
         */
        push: function(value, cost) {
          var item = { value, cost };
          this.queue.push(item);
          this.queue.sort(this.sorter);
        },
        /**
         * Return the highest priority element in the queue.
         */
        pop: function() {
          return this.queue.shift();
        },
        empty: function() {
          return this.queue.length === 0;
        }
      }
    };
    if (typeof module2 !== "undefined") {
      module2.exports = dijkstra;
    }
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/segments.js
var require_segments = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/segments.js"(exports) {
    var Mode = require_mode();
    var NumericData = require_numeric_data();
    var AlphanumericData = require_alphanumeric_data();
    var ByteData = require_byte_data();
    var KanjiData = require_kanji_data();
    var Regex = require_regex();
    var Utils = require_utils();
    var dijkstra = require_dijkstra();
    function getStringByteLength(str) {
      return unescape(encodeURIComponent(str)).length;
    }
    function getSegments(regex, mode, str) {
      const segments = [];
      let result;
      while ((result = regex.exec(str)) !== null) {
        segments.push({
          data: result[0],
          index: result.index,
          mode,
          length: result[0].length
        });
      }
      return segments;
    }
    function getSegmentsFromString(dataStr) {
      const numSegs = getSegments(Regex.NUMERIC, Mode.NUMERIC, dataStr);
      const alphaNumSegs = getSegments(Regex.ALPHANUMERIC, Mode.ALPHANUMERIC, dataStr);
      let byteSegs;
      let kanjiSegs;
      if (Utils.isKanjiModeEnabled()) {
        byteSegs = getSegments(Regex.BYTE, Mode.BYTE, dataStr);
        kanjiSegs = getSegments(Regex.KANJI, Mode.KANJI, dataStr);
      } else {
        byteSegs = getSegments(Regex.BYTE_KANJI, Mode.BYTE, dataStr);
        kanjiSegs = [];
      }
      const segs = numSegs.concat(alphaNumSegs, byteSegs, kanjiSegs);
      return segs.sort(function(s1, s2) {
        return s1.index - s2.index;
      }).map(function(obj) {
        return {
          data: obj.data,
          mode: obj.mode,
          length: obj.length
        };
      });
    }
    function getSegmentBitsLength(length, mode) {
      switch (mode) {
        case Mode.NUMERIC:
          return NumericData.getBitsLength(length);
        case Mode.ALPHANUMERIC:
          return AlphanumericData.getBitsLength(length);
        case Mode.KANJI:
          return KanjiData.getBitsLength(length);
        case Mode.BYTE:
          return ByteData.getBitsLength(length);
      }
    }
    function mergeSegments(segs) {
      return segs.reduce(function(acc, curr) {
        const prevSeg = acc.length - 1 >= 0 ? acc[acc.length - 1] : null;
        if (prevSeg && prevSeg.mode === curr.mode) {
          acc[acc.length - 1].data += curr.data;
          return acc;
        }
        acc.push(curr);
        return acc;
      }, []);
    }
    function buildNodes(segs) {
      const nodes = [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        switch (seg.mode) {
          case Mode.NUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.ALPHANUMERIC, length: seg.length },
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.ALPHANUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.KANJI:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
            break;
          case Mode.BYTE:
            nodes.push([
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
        }
      }
      return nodes;
    }
    function buildGraph(nodes, version) {
      const table = {};
      const graph = { start: {} };
      let prevNodeIds = ["start"];
      for (let i = 0; i < nodes.length; i++) {
        const nodeGroup = nodes[i];
        const currentNodeIds = [];
        for (let j = 0; j < nodeGroup.length; j++) {
          const node = nodeGroup[j];
          const key = "" + i + j;
          currentNodeIds.push(key);
          table[key] = { node, lastCount: 0 };
          graph[key] = {};
          for (let n = 0; n < prevNodeIds.length; n++) {
            const prevNodeId = prevNodeIds[n];
            if (table[prevNodeId] && table[prevNodeId].node.mode === node.mode) {
              graph[prevNodeId][key] = getSegmentBitsLength(table[prevNodeId].lastCount + node.length, node.mode) - getSegmentBitsLength(table[prevNodeId].lastCount, node.mode);
              table[prevNodeId].lastCount += node.length;
            } else {
              if (table[prevNodeId]) table[prevNodeId].lastCount = node.length;
              graph[prevNodeId][key] = getSegmentBitsLength(node.length, node.mode) + 4 + Mode.getCharCountIndicator(node.mode, version);
            }
          }
        }
        prevNodeIds = currentNodeIds;
      }
      for (let n = 0; n < prevNodeIds.length; n++) {
        graph[prevNodeIds[n]].end = 0;
      }
      return { map: graph, table };
    }
    function buildSingleSegment(data, modesHint) {
      let mode;
      const bestMode = Mode.getBestModeForData(data);
      mode = Mode.from(modesHint, bestMode);
      if (mode !== Mode.BYTE && mode.bit < bestMode.bit) {
        throw new Error('"' + data + '" cannot be encoded with mode ' + Mode.toString(mode) + ".\n Suggested mode is: " + Mode.toString(bestMode));
      }
      if (mode === Mode.KANJI && !Utils.isKanjiModeEnabled()) {
        mode = Mode.BYTE;
      }
      switch (mode) {
        case Mode.NUMERIC:
          return new NumericData(data);
        case Mode.ALPHANUMERIC:
          return new AlphanumericData(data);
        case Mode.KANJI:
          return new KanjiData(data);
        case Mode.BYTE:
          return new ByteData(data);
      }
    }
    exports.fromArray = function fromArray(array) {
      return array.reduce(function(acc, seg) {
        if (typeof seg === "string") {
          acc.push(buildSingleSegment(seg, null));
        } else if (seg.data) {
          acc.push(buildSingleSegment(seg.data, seg.mode));
        }
        return acc;
      }, []);
    };
    exports.fromString = function fromString(data, version) {
      const segs = getSegmentsFromString(data, Utils.isKanjiModeEnabled());
      const nodes = buildNodes(segs);
      const graph = buildGraph(nodes, version);
      const path = dijkstra.find_path(graph.map, "start", "end");
      const optimizedSegs = [];
      for (let i = 1; i < path.length - 1; i++) {
        optimizedSegs.push(graph.table[path[i]].node);
      }
      return exports.fromArray(mergeSegments(optimizedSegs));
    };
    exports.rawSplit = function rawSplit(data) {
      return exports.fromArray(
        getSegmentsFromString(data, Utils.isKanjiModeEnabled())
      );
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/core/qrcode.js
var require_qrcode = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/core/qrcode.js"(exports) {
    var Utils = require_utils();
    var ECLevel = require_error_correction_level();
    var BitBuffer = require_bit_buffer();
    var BitMatrix = require_bit_matrix();
    var AlignmentPattern = require_alignment_pattern();
    var FinderPattern = require_finder_pattern();
    var MaskPattern = require_mask_pattern();
    var ECCode = require_error_correction_code();
    var ReedSolomonEncoder = require_reed_solomon_encoder();
    var Version = require_version();
    var FormatInfo = require_format_info();
    var Mode = require_mode();
    var Segments = require_segments();
    function setupFinderPattern(matrix, version) {
      const size = matrix.size;
      const pos = FinderPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -1; r <= 7; r++) {
          if (row + r <= -1 || size <= row + r) continue;
          for (let c = -1; c <= 7; c++) {
            if (col + c <= -1 || size <= col + c) continue;
            if (r >= 0 && r <= 6 && (c === 0 || c === 6) || c >= 0 && c <= 6 && (r === 0 || r === 6) || r >= 2 && r <= 4 && c >= 2 && c <= 4) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupTimingPattern(matrix) {
      const size = matrix.size;
      for (let r = 8; r < size - 8; r++) {
        const value = r % 2 === 0;
        matrix.set(r, 6, value, true);
        matrix.set(6, r, value, true);
      }
    }
    function setupAlignmentPattern(matrix, version) {
      const pos = AlignmentPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (r === -2 || r === 2 || c === -2 || c === 2 || r === 0 && c === 0) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupVersionInfo(matrix, version) {
      const size = matrix.size;
      const bits = Version.getEncodedBits(version);
      let row, col, mod;
      for (let i = 0; i < 18; i++) {
        row = Math.floor(i / 3);
        col = i % 3 + size - 8 - 3;
        mod = (bits >> i & 1) === 1;
        matrix.set(row, col, mod, true);
        matrix.set(col, row, mod, true);
      }
    }
    function setupFormatInfo(matrix, errorCorrectionLevel, maskPattern) {
      const size = matrix.size;
      const bits = FormatInfo.getEncodedBits(errorCorrectionLevel, maskPattern);
      let i, mod;
      for (i = 0; i < 15; i++) {
        mod = (bits >> i & 1) === 1;
        if (i < 6) {
          matrix.set(i, 8, mod, true);
        } else if (i < 8) {
          matrix.set(i + 1, 8, mod, true);
        } else {
          matrix.set(size - 15 + i, 8, mod, true);
        }
        if (i < 8) {
          matrix.set(8, size - i - 1, mod, true);
        } else if (i < 9) {
          matrix.set(8, 15 - i - 1 + 1, mod, true);
        } else {
          matrix.set(8, 15 - i - 1, mod, true);
        }
      }
      matrix.set(size - 8, 8, 1, true);
    }
    function setupData(matrix, data) {
      const size = matrix.size;
      let inc = -1;
      let row = size - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (!matrix.isReserved(row, col - c)) {
              let dark = false;
              if (byteIndex < data.length) {
                dark = (data[byteIndex] >>> bitIndex & 1) === 1;
              }
              matrix.set(row, col - c, dark);
              bitIndex--;
              if (bitIndex === -1) {
                byteIndex++;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || size <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    }
    function createData(version, errorCorrectionLevel, segments) {
      const buffer = new BitBuffer();
      segments.forEach(function(data) {
        buffer.put(data.mode.bit, 4);
        buffer.put(data.getLength(), Mode.getCharCountIndicator(data.mode, version));
        data.write(buffer);
      });
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (buffer.getLengthInBits() + 4 <= dataTotalCodewordsBits) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 !== 0) {
        buffer.putBit(0);
      }
      const remainingByte = (dataTotalCodewordsBits - buffer.getLengthInBits()) / 8;
      for (let i = 0; i < remainingByte; i++) {
        buffer.put(i % 2 ? 17 : 236, 8);
      }
      return createCodewords(buffer, version, errorCorrectionLevel);
    }
    function createCodewords(bitBuffer, version, errorCorrectionLevel) {
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewords = totalCodewords - ecTotalCodewords;
      const ecTotalBlocks = ECCode.getBlocksCount(version, errorCorrectionLevel);
      const blocksInGroup2 = totalCodewords % ecTotalBlocks;
      const blocksInGroup1 = ecTotalBlocks - blocksInGroup2;
      const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1;
      const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1;
      const rs = new ReedSolomonEncoder(ecCount);
      let offset = 0;
      const dcData = new Array(ecTotalBlocks);
      const ecData = new Array(ecTotalBlocks);
      let maxDataSize = 0;
      const buffer = new Uint8Array(bitBuffer.buffer);
      for (let b = 0; b < ecTotalBlocks; b++) {
        const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
        dcData[b] = buffer.slice(offset, offset + dataSize);
        ecData[b] = rs.encode(dcData[b]);
        offset += dataSize;
        maxDataSize = Math.max(maxDataSize, dataSize);
      }
      const data = new Uint8Array(totalCodewords);
      let index = 0;
      let i, r;
      for (i = 0; i < maxDataSize; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          if (i < dcData[r].length) {
            data[index++] = dcData[r][i];
          }
        }
      }
      for (i = 0; i < ecCount; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          data[index++] = ecData[r][i];
        }
      }
      return data;
    }
    function createSymbol(data, version, errorCorrectionLevel, maskPattern) {
      let segments;
      if (Array.isArray(data)) {
        segments = Segments.fromArray(data);
      } else if (typeof data === "string") {
        let estimatedVersion = version;
        if (!estimatedVersion) {
          const rawSegments = Segments.rawSplit(data);
          estimatedVersion = Version.getBestVersionForData(rawSegments, errorCorrectionLevel);
        }
        segments = Segments.fromString(data, estimatedVersion || 40);
      } else {
        throw new Error("Invalid data");
      }
      const bestVersion = Version.getBestVersionForData(segments, errorCorrectionLevel);
      if (!bestVersion) {
        throw new Error("The amount of data is too big to be stored in a QR Code");
      }
      if (!version) {
        version = bestVersion;
      } else if (version < bestVersion) {
        throw new Error(
          "\nThe chosen QR Code version cannot contain this amount of data.\nMinimum version required to store current data is: " + bestVersion + ".\n"
        );
      }
      const dataBits = createData(version, errorCorrectionLevel, segments);
      const moduleCount = Utils.getSymbolSize(version);
      const modules = new BitMatrix(moduleCount);
      setupFinderPattern(modules, version);
      setupTimingPattern(modules);
      setupAlignmentPattern(modules, version);
      setupFormatInfo(modules, errorCorrectionLevel, 0);
      if (version >= 7) {
        setupVersionInfo(modules, version);
      }
      setupData(modules, dataBits);
      if (isNaN(maskPattern)) {
        maskPattern = MaskPattern.getBestMask(
          modules,
          setupFormatInfo.bind(null, modules, errorCorrectionLevel)
        );
      }
      MaskPattern.applyMask(maskPattern, modules);
      setupFormatInfo(modules, errorCorrectionLevel, maskPattern);
      return {
        modules,
        version,
        errorCorrectionLevel,
        maskPattern,
        segments
      };
    }
    exports.create = function create(data, options) {
      if (typeof data === "undefined" || data === "") {
        throw new Error("No input text");
      }
      let errorCorrectionLevel = ECLevel.M;
      let version;
      let mask;
      if (typeof options !== "undefined") {
        errorCorrectionLevel = ECLevel.from(options.errorCorrectionLevel, ECLevel.M);
        version = Version.from(options.version);
        mask = MaskPattern.from(options.maskPattern);
        if (options.toSJISFunc) {
          Utils.setToSJISFunction(options.toSJISFunc);
        }
      }
      return createSymbol(data, version, errorCorrectionLevel, mask);
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/renderer/utils.js
var require_utils2 = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/renderer/utils.js"(exports) {
    function hex2rgba(hex) {
      if (typeof hex === "number") {
        hex = hex.toString();
      }
      if (typeof hex !== "string") {
        throw new Error("Color should be defined as hex string");
      }
      let hexCode = hex.slice().replace("#", "").split("");
      if (hexCode.length < 3 || hexCode.length === 5 || hexCode.length > 8) {
        throw new Error("Invalid hex color: " + hex);
      }
      if (hexCode.length === 3 || hexCode.length === 4) {
        hexCode = Array.prototype.concat.apply([], hexCode.map(function(c) {
          return [c, c];
        }));
      }
      if (hexCode.length === 6) hexCode.push("F", "F");
      const hexValue = parseInt(hexCode.join(""), 16);
      return {
        r: hexValue >> 24 & 255,
        g: hexValue >> 16 & 255,
        b: hexValue >> 8 & 255,
        a: hexValue & 255,
        hex: "#" + hexCode.slice(0, 6).join("")
      };
    }
    exports.getOptions = function getOptions(options) {
      if (!options) options = {};
      if (!options.color) options.color = {};
      const margin = typeof options.margin === "undefined" || options.margin === null || options.margin < 0 ? 4 : options.margin;
      const width = options.width && options.width >= 21 ? options.width : void 0;
      const scale = options.scale || 4;
      return {
        width,
        scale: width ? 4 : scale,
        margin,
        color: {
          dark: hex2rgba(options.color.dark || "#000000ff"),
          light: hex2rgba(options.color.light || "#ffffffff")
        },
        type: options.type,
        rendererOpts: options.rendererOpts || {}
      };
    };
    exports.getScale = function getScale(qrSize, opts) {
      return opts.width && opts.width >= qrSize + opts.margin * 2 ? opts.width / (qrSize + opts.margin * 2) : opts.scale;
    };
    exports.getImageWidth = function getImageWidth(qrSize, opts) {
      const scale = exports.getScale(qrSize, opts);
      return Math.floor((qrSize + opts.margin * 2) * scale);
    };
    exports.qrToImageData = function qrToImageData(imgData, qr, opts) {
      const size = qr.modules.size;
      const data = qr.modules.data;
      const scale = exports.getScale(size, opts);
      const symbolSize = Math.floor((size + opts.margin * 2) * scale);
      const scaledMargin = opts.margin * scale;
      const palette = [opts.color.light, opts.color.dark];
      for (let i = 0; i < symbolSize; i++) {
        for (let j = 0; j < symbolSize; j++) {
          let posDst = (i * symbolSize + j) * 4;
          let pxColor = opts.color.light;
          if (i >= scaledMargin && j >= scaledMargin && i < symbolSize - scaledMargin && j < symbolSize - scaledMargin) {
            const iSrc = Math.floor((i - scaledMargin) / scale);
            const jSrc = Math.floor((j - scaledMargin) / scale);
            pxColor = palette[data[iSrc * size + jSrc] ? 1 : 0];
          }
          imgData[posDst++] = pxColor.r;
          imgData[posDst++] = pxColor.g;
          imgData[posDst++] = pxColor.b;
          imgData[posDst] = pxColor.a;
        }
      }
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/renderer/canvas.js
var require_canvas = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/renderer/canvas.js"(exports) {
    var Utils = require_utils2();
    function clearCanvas(ctx, canvas, size) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!canvas.style) canvas.style = {};
      canvas.height = size;
      canvas.width = size;
      canvas.style.height = size + "px";
      canvas.style.width = size + "px";
    }
    function getCanvasElement() {
      try {
        return document.createElement("canvas");
      } catch (e) {
        throw new Error("You need to specify a canvas element");
      }
    }
    exports.render = function render(qrData, canvas, options) {
      let opts = options;
      let canvasEl = canvas;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!canvas) {
        canvasEl = getCanvasElement();
      }
      opts = Utils.getOptions(opts);
      const size = Utils.getImageWidth(qrData.modules.size, opts);
      const ctx = canvasEl.getContext("2d");
      const image = ctx.createImageData(size, size);
      Utils.qrToImageData(image.data, qrData, opts);
      clearCanvas(ctx, canvasEl, size);
      ctx.putImageData(image, 0, 0);
      return canvasEl;
    };
    exports.renderToDataURL = function renderToDataURL(qrData, canvas, options) {
      let opts = options;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!opts) opts = {};
      const canvasEl = exports.render(qrData, canvas, opts);
      const type = opts.type || "image/png";
      const rendererOpts = opts.rendererOpts || {};
      return canvasEl.toDataURL(type, rendererOpts.quality);
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/renderer/svg-tag.js
var require_svg_tag = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/renderer/svg-tag.js"(exports) {
    var Utils = require_utils2();
    function getColorAttrib(color, attrib) {
      const alpha = color.a / 255;
      const str = attrib + '="' + color.hex + '"';
      return alpha < 1 ? str + " " + attrib + '-opacity="' + alpha.toFixed(2).slice(1) + '"' : str;
    }
    function svgCmd(cmd, x, y) {
      let str = cmd + x;
      if (typeof y !== "undefined") str += " " + y;
      return str;
    }
    function qrToPath(data, size, margin) {
      let path = "";
      let moveBy = 0;
      let newRow = false;
      let lineLength = 0;
      for (let i = 0; i < data.length; i++) {
        const col = Math.floor(i % size);
        const row = Math.floor(i / size);
        if (!col && !newRow) newRow = true;
        if (data[i]) {
          lineLength++;
          if (!(i > 0 && col > 0 && data[i - 1])) {
            path += newRow ? svgCmd("M", col + margin, 0.5 + row + margin) : svgCmd("m", moveBy, 0);
            moveBy = 0;
            newRow = false;
          }
          if (!(col + 1 < size && data[i + 1])) {
            path += svgCmd("h", lineLength);
            lineLength = 0;
          }
        } else {
          moveBy++;
        }
      }
      return path;
    }
    exports.render = function render(qrData, options, cb) {
      const opts = Utils.getOptions(options);
      const size = qrData.modules.size;
      const data = qrData.modules.data;
      const qrcodesize = size + opts.margin * 2;
      const bg = !opts.color.light.a ? "" : "<path " + getColorAttrib(opts.color.light, "fill") + ' d="M0 0h' + qrcodesize + "v" + qrcodesize + 'H0z"/>';
      const path = "<path " + getColorAttrib(opts.color.dark, "stroke") + ' d="' + qrToPath(data, size, opts.margin) + '"/>';
      const viewBox = 'viewBox="0 0 ' + qrcodesize + " " + qrcodesize + '"';
      const width = !opts.width ? "" : 'width="' + opts.width + '" height="' + opts.width + '" ';
      const svgTag = '<svg xmlns="http://www.w3.org/2000/svg" ' + width + viewBox + ' shape-rendering="crispEdges">' + bg + path + "</svg>\n";
      if (typeof cb === "function") {
        cb(null, svgTag);
      }
      return svgTag;
    };
  }
});

// ../dsh-work-anywhere/node_modules/qrcode/lib/browser.js
var require_browser = __commonJS({
  "../dsh-work-anywhere/node_modules/qrcode/lib/browser.js"(exports) {
    var canPromise = require_can_promise();
    var QRCode2 = require_qrcode();
    var CanvasRenderer = require_canvas();
    var SvgRenderer = require_svg_tag();
    function renderCanvas(renderFunc, canvas, text, opts, cb) {
      const args = [].slice.call(arguments, 1);
      const argsNum = args.length;
      const isLastArgCb = typeof args[argsNum - 1] === "function";
      if (!isLastArgCb && !canPromise()) {
        throw new Error("Callback required as last argument");
      }
      if (isLastArgCb) {
        if (argsNum < 2) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 2) {
          cb = text;
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 3) {
          if (canvas.getContext && typeof cb === "undefined") {
            cb = opts;
            opts = void 0;
          } else {
            cb = opts;
            opts = text;
            text = canvas;
            canvas = void 0;
          }
        }
      } else {
        if (argsNum < 1) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 1) {
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 2 && !canvas.getContext) {
          opts = text;
          text = canvas;
          canvas = void 0;
        }
        return new Promise(function(resolve, reject) {
          try {
            const data = QRCode2.create(text, opts);
            resolve(renderFunc(data, canvas, opts));
          } catch (e) {
            reject(e);
          }
        });
      }
      try {
        const data = QRCode2.create(text, opts);
        cb(null, renderFunc(data, canvas, opts));
      } catch (e) {
        cb(e);
      }
    }
    exports.create = QRCode2.create;
    exports.toCanvas = renderCanvas.bind(null, CanvasRenderer.render);
    exports.toDataURL = renderCanvas.bind(null, CanvasRenderer.renderToDataURL);
    exports.toString = renderCanvas.bind(null, function(data, _, opts) {
      return SvgRenderer.render(data, opts);
    });
  }
});

// src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var import_qrcode = __toESM(require_browser(), 1);
var name = "dsh-work-anywhere";
var inject = ["slots"];
var API = {
  hosts: "/api/dsh-remote-lab/hosts",
  projects: "/api/dsh-remote-lab/workspaces",
  bindings: "/api/dsh-remote-lab/bindings",
  sessionBinding: "/api/dsh-remote-lab/session-binding",
  gitConfig: "/api/dsh-remote-lab/git-config",
  // 微信 ClawBot 频道（由 dsh-wechat-channel 宿主半提供；未安装时路由 404）
  wcStatus: "/api/dsh-wechat-channel/status",
  wcLogin: "/api/dsh-wechat-channel/login",
  wcVerify: "/api/dsh-wechat-channel/verify",
  wcCancelLogin: "/api/dsh-wechat-channel/cancel-login",
  wcLogout: "/api/dsh-wechat-channel/logout",
  wcSwitch: "/api/dsh-wechat-channel/switch"
};
async function apiGet(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
  return data;
}
async function apiSend(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
  return data;
}
var S = {
  page: { padding: "16px", display: "flex", flexDirection: "column", gap: "14px", maxWidth: "820px", color: "var(--dsw-alias-label-primary)" },
  hint: { fontSize: "13px", lineHeight: "1.7", color: "var(--dsw-alias-label-secondary)" },
  card: { border: "1px solid var(--dsw-alias-border-l1)", borderRadius: "10px", padding: "14px", display: "flex", flexDirection: "column", gap: "10px", background: "var(--dsw-alias-bg-layer-1)" },
  cardTitle: { fontSize: "14px", fontWeight: "600", color: "var(--dsw-alias-label-primary)" },
  label: { display: "block", fontSize: "12px", marginBottom: "4px", color: "var(--dsw-alias-label-secondary)" },
  input: { width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: "6px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)", fontSize: "13px" },
  row: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" },
  field: { flex: "1 1 180px", display: "flex", flexDirection: "column" },
  btn: { padding: "7px 14px", borderRadius: "6px", border: "1px solid var(--dsw-alias-border-l1)", cursor: "pointer", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)", fontSize: "13px" },
  btnSmall: { padding: "4px 10px", borderRadius: "6px", border: "1px solid var(--dsw-alias-brand-primary)", cursor: "pointer", background: "var(--dsw-alias-brand-primary)", color: "#fff", fontSize: "12px", whiteSpace: "nowrap" },
  btnPrimary: { padding: "7px 16px", borderRadius: "6px", border: "1px solid var(--dsw-alias-brand-primary)", cursor: "pointer", background: "var(--dsw-alias-brand-primary)", color: "#fff", fontSize: "13px", fontWeight: "500" },
  msg: { fontSize: "13px", whiteSpace: "pre-wrap", color: "var(--dsw-alias-label-secondary)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px", color: "var(--dsw-alias-label-primary)" },
  td: { padding: "6px 8px", borderBottom: "1px solid var(--dsw-alias-border-l1)", verticalAlign: "top" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: "12px", wordBreak: "break-all", color: "var(--dsw-alias-label-secondary)" },
  empty: { fontSize: "13px", padding: "8px 0", color: "var(--dsw-alias-label-secondary)" },
  tag: { display: "inline-block", padding: "1px 8px", borderRadius: "10px", fontSize: "12px", border: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-secondary)" },
  tagOk: { display: "inline-block", padding: "1px 8px", borderRadius: "10px", fontSize: "12px", border: "1px solid var(--dsw-alias-state-success-primary)", color: "var(--dsw-alias-state-success-primary)" },
  dot: { display: "inline-block", width: "9px", height: "9px", borderRadius: "50%", marginRight: "8px", verticalAlign: "middle" },
  dotOn: { background: "var(--dsw-alias-state-success-primary)" },
  dotOff: { background: "var(--dsw-alias-border-l2)" },
  qrBox: { display: "inline-block", background: "#fff", padding: "10px", borderRadius: "8px" },
  qrImg: { width: "220px", height: "220px", display: "block" },
  link: { fontSize: "12px", color: "var(--dsw-alias-brand-primary)", wordBreak: "break-all" },
  select: { padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)", fontSize: "12px", maxWidth: "220px" },
  // 弹窗
  backdrop: { position: "fixed", inset: "0", background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1e3 },
  modal: { background: "var(--dsw-alias-bg-overlay)", color: "var(--dsw-alias-label-primary)", borderRadius: "12px", padding: "18px", width: "min(560px, 92vw)", maxHeight: "86vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 12px 40px rgba(0,0,0,0.25)" },
  modalTitle: { fontSize: "15px", fontWeight: "600", color: "var(--dsw-alias-label-primary)" },
  pathLine: { fontSize: "12px", fontFamily: "ui-monospace, monospace", wordBreak: "break-all", color: "var(--dsw-alias-label-secondary)" }
};
function planText(plan) {
  if (!plan) return "\u65E0\u8BA1\u5212";
  const c = plan.counts || {};
  const parts = [];
  if (c.running) parts.push(c.running + " \u8FD0\u884C\u4E2D");
  if (c.pending) parts.push(c.pending + " \u5F85\u542F\u52A8");
  if (c.succeeded) parts.push(c.succeeded + " \u6210\u529F");
  if (c.failed) parts.push(c.failed + " \u5931\u8D25");
  if (c.stopped) parts.push(c.stopped + " \u5DF2\u505C\u6B62");
  if (c.detached) parts.push(c.detached + " \u65AD\u7EBF");
  return parts.length ? parts.join(" \xB7 ") : "\u65E0\u5B9E\u9A8C";
}
function BindDialog({ sessionId, onClose }) {
  const [info, setInfo] = import_react.default.useState(null);
  const [form, setForm] = import_react.default.useState({ alias: "", remoteRoot: "", sudoPassword: "" });
  const [busy, setBusy] = import_react.default.useState(false);
  const [msg, setMsg] = import_react.default.useState("");
  const loadInfo = import_react.default.useCallback(async () => {
    const d = await apiGet(API.sessionBinding + "?sessionId=" + encodeURIComponent(sessionId));
    setInfo(d);
    if (d.binding) {
      setForm({ alias: d.binding.alias, remoteRoot: d.binding.remoteRoot, sudoPassword: d.binding.sudoPassword || "" });
    }
    return d;
  }, [sessionId]);
  import_react.default.useEffect(() => {
    loadInfo().catch((e) => setMsg("\u52A0\u8F7D\u5931\u8D25\uFF1A" + String(e && e.message || e)));
  }, [loadInfo]);
  const set = (k) => (ev) => setForm((f) => ({ ...f, [k]: ev.target.value }));
  const save = async () => {
    if (!form.alias) {
      setMsg("\u8BF7\u9009\u62E9\u670D\u52A1\u5668");
      return;
    }
    setBusy(true);
    try {
      await apiSend("POST", API.bindings, {
        sessionId,
        alias: form.alias,
        remoteRoot: form.remoteRoot || void 0,
        sudoPassword: form.sudoPassword || void 0
      });
      const d = await loadInfo();
      setMsg("\u5DF2\u4FDD\u5B58\uFF1A\u672C\u9879\u76EE \u2192 " + form.alias + (d.binding ? "\uFF08" + d.binding.remoteRoot + "\uFF09" : ""));
    } catch (e) {
      setMsg("\u4FDD\u5B58\u5931\u8D25\uFF1A" + String(e && e.message || e));
    } finally {
      setBusy(false);
    }
  };
  const unbind = async () => {
    if (!info || !info.path) return;
    if (!window.confirm("\u89E3\u9664\u672C\u9879\u76EE\u7684\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u7ED1\u5B9A\uFF1F\uFF08\u8FDC\u7AEF\u76EE\u5F55\u4E0E\u672C\u5730\u4EA7\u7269\u4E0D\u53D7\u5F71\u54CD\uFF09")) return;
    setBusy(true);
    try {
      await apiSend("DELETE", API.bindings, { path: info.path });
      await loadInfo();
      setMsg("\u5DF2\u89E3\u7ED1\u672C\u9879\u76EE");
    } catch (e) {
      setMsg("\u89E3\u7ED1\u5931\u8D25\uFF1A" + String(e && e.message || e));
    } finally {
      setBusy(false);
    }
  };
  const hosts = info && info.hosts || [];
  return import_react.default.createElement(
    "div",
    { style: S.backdrop, onClick: (ev) => {
      if (ev.target === ev.currentTarget) onClose();
    } },
    import_react.default.createElement(
      "div",
      { style: S.modal },
      import_react.default.createElement(
        "div",
        { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
        import_react.default.createElement("div", { style: S.modalTitle }, "\u8FDC\u7A0B\u5B9E\u9A8C\uFF08\u672C\u9879\u76EE\uFF09"),
        import_react.default.createElement("button", { style: S.btnSmall, onClick: onClose }, "\u5173\u95ED")
      ),
      info ? import_react.default.createElement(
        "div",
        { style: S.pathLine },
        "\u9879\u76EE\uFF1A" + (info.title || "") + "  " + (info.path || ""),
        info.binding ? import_react.default.createElement(
          "div",
          { style: { marginTop: "4px" } },
          import_react.default.createElement("span", { style: S.tagOk }, "\u5DF2\u7ED1\u5B9A " + info.binding.alias + " \u2192 " + info.binding.remoteRoot)
        ) : import_react.default.createElement("div", { style: { marginTop: "4px" } }, import_react.default.createElement("span", { style: S.tag }, "\u672A\u7ED1\u5B9A"))
      ) : null,
      import_react.default.createElement(
        "div",
        { style: S.row },
        import_react.default.createElement(
          "div",
          { style: S.field },
          import_react.default.createElement("label", { style: S.label }, "\u670D\u52A1\u5668"),
          hosts.length === 0 ? import_react.default.createElement("div", { style: S.hint }, "\u8BF7\u5148\u5230\u4FA7\u8FB9\u680F\u300CSSH\u300D\u9762\u677F\u6DFB\u52A0\u4E3B\u673A") : import_react.default.createElement(
            "select",
            { style: S.input, value: form.alias, onChange: set("alias") },
            import_react.default.createElement("option", { value: "", disabled: true }, "\u9009\u62E9\u4E3B\u673A"),
            hosts.map((h) => import_react.default.createElement("option", { key: h.alias, value: h.alias }, h.alias + "\uFF08" + h.user + "@" + h.host + ":" + h.port + "\uFF09"))
          )
        ),
        import_react.default.createElement(
          "div",
          { style: S.field },
          import_react.default.createElement("label", { style: S.label }, "\u8FDC\u7AEF\u6839\u76EE\u5F55\uFF08\u53EF\u9009\uFF09"),
          import_react.default.createElement("input", { style: S.input, value: form.remoteRoot, onChange: set("remoteRoot"), placeholder: "\u9ED8\u8BA4 ~/remote-lab/<\u9879\u76EE\u540D>" })
        ),
        import_react.default.createElement(
          "div",
          { style: S.field },
          import_react.default.createElement("label", { style: S.label }, "sudo \u5BC6\u7801\uFF08\u53EF\u9009\uFF09"),
          import_react.default.createElement("input", { type: "password", style: S.input, value: form.sudoPassword, onChange: set("sudoPassword"), placeholder: "\u76EE\u6807\u76EE\u5F55\u9700 root \u6743\u9650\u65F6\u5FC5\u586B" })
        )
      ),
      import_react.default.createElement(
        "div",
        { style: S.row },
        import_react.default.createElement("button", { style: S.btnPrimary, onClick: save, disabled: busy || hosts.length === 0 }, busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u7ED1\u5B9A"),
        info && info.binding ? import_react.default.createElement("button", { style: S.btn, onClick: unbind, disabled: busy }, "\u89E3\u7ED1") : null
      ),
      msg ? import_react.default.createElement("div", { style: S.msg }, msg) : null
    )
  );
}
function HeaderBindButton(props) {
  const [open, setOpen] = import_react.default.useState(false);
  return import_react.default.createElement(
    import_react.default.Fragment,
    null,
    import_react.default.createElement("button", {
      style: S.btnSmall,
      title: "\u914D\u7F6E\u672C\u9879\u76EE\u7ED1\u5B9A\u7684\u8FDC\u7A0B\u670D\u52A1\u5668\u4E0E\u5DE5\u4F5C\u533A\uFF08\u4EC5\u672C\u9879\u76EE\u751F\u6548\uFF09",
      onClick: () => setOpen((o) => !o)
    }, "\u8FDC\u7A0B\u5B9E\u9A8C"),
    open && props.sessionId ? import_react.default.createElement(BindDialog, { sessionId: props.sessionId, onClose: () => setOpen(false) }) : null
  );
}
function WechatControlCard() {
  const [data, setData] = import_react.default.useState(null);
  const [missing, setMissing] = import_react.default.useState(false);
  const [busy, setBusy] = import_react.default.useState(false);
  const [msg, setMsg] = import_react.default.useState("");
  const [qrDataUrl, setQrDataUrl] = import_react.default.useState("");
  const [verifyCode, setVerifyCode] = import_react.default.useState("");
  import_react.default.useEffect(() => {
    let alive = true;
    let timer = null;
    const tick = async () => {
      if (!alive) return;
      try {
        setData(await apiGet(API.wcStatus));
        setMissing(false);
      } catch {
        setMissing(true);
      }
      timer = setTimeout(tick, 3e3);
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
  import_react.default.useEffect(() => {
    const url = data && data.login ? data.login.qrcodeUrl : "";
    if (!url) {
      setQrDataUrl("");
      return;
    }
    let alive = true;
    import_qrcode.default.toDataURL(url, { width: 220, margin: 1 }).then((u) => {
      if (alive) setQrDataUrl(u);
    }).catch(() => {
      if (alive) setQrDataUrl("");
    });
    return () => {
      alive = false;
    };
  }, [data && data.login && data.login.qrcodeUrl]);
  const act = async (fn, okText) => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fn();
      if (okText) setMsg(okText);
      if (r) setData(await apiGet(API.wcStatus));
    } catch (e) {
      setMsg("\u26A0 " + String(e && e.message || e));
    } finally {
      setBusy(false);
    }
  };
  const connected = data && data.connected;
  const login = data && data.login;
  return import_react.default.createElement(
    "div",
    { style: S.card },
    import_react.default.createElement("div", { style: S.cardTitle }, "\u5FAE\u4FE1 / \u98DE\u4E66\u8FDC\u7A0B\u63A7\u5236"),
    missing ? import_react.default.createElement("div", { style: S.hint }, "\u5FAE\u4FE1\u9891\u9053\u63D2\u4EF6\uFF08dsh-wechat-channel\uFF09\u672A\u5B89\u88C5\u6216\u672A\u52A0\u8F7D\uFF0C\u65E0\u6CD5\u5728\u6B64\u8FDE\u63A5\u5FAE\u4FE1\u3002") : import_react.default.createElement(
      import_react.default.Fragment,
      null,
      import_react.default.createElement(
        "div",
        { style: { ...S.row, alignItems: "center" } },
        import_react.default.createElement(
          "span",
          { style: { fontSize: "14px" } },
          import_react.default.createElement("span", { style: { ...S.dot, ...connected ? S.dotOn : S.dotOff } }),
          connected ? "\u5DF2\u8FDE\u63A5\u5FAE\u4FE1 ClawBot \xB7 " + connected.accountId : "\u672A\u8FDE\u63A5\u5FAE\u4FE1"
        ),
        connected ? import_react.default.createElement("button", { style: S.btn, disabled: busy, onClick: () => act(() => apiSend("POST", API.wcLogout), "\u5DF2\u65AD\u5F00") }, busy ? "\u5904\u7406\u4E2D\u2026" : "\u65AD\u5F00\u8FDE\u63A5") : import_react.default.createElement("button", { style: S.btnPrimary, disabled: busy || !!login, onClick: () => act(() => apiSend("POST", API.wcLogin)) }, busy ? "\u5904\u7406\u4E2D\u2026" : "\u8FDE\u63A5\u5FAE\u4FE1"),
        login ? import_react.default.createElement("button", { style: S.btn, onClick: () => act(() => apiSend("POST", API.wcCancelLogin), "\u5DF2\u53D6\u6D88") }, "\u53D6\u6D88") : null
      ),
      connected ? import_react.default.createElement("div", { style: S.hint }, "\u5728\u5FAE\u4FE1\u91CC\u7ED9\u8BE5 ClawBot \u53D1\u6D88\u606F\u5373\u53EF\u63A7\u5236 dsh\uFF08\u9879\u76EE\u67E5\u8BE2 /projects\u3001\u5207\u6362 /switch <\u7F16\u53F7|\u540D\u79F0>\u3001\u72B6\u6001 /status\u3001\u5E2E\u52A9 /help\uFF09\u3002") : null,
      login && login.phase === "qr" ? import_react.default.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" } },
        import_react.default.createElement("div", { style: S.hint }, login.message || "\u8BF7\u7528\u624B\u673A\u5FAE\u4FE1\u626B\u7801"),
        qrDataUrl ? import_react.default.createElement("div", { style: S.qrBox }, import_react.default.createElement("img", { style: S.qrImg, src: qrDataUrl, alt: "wechat qr" })) : null,
        import_react.default.createElement("a", { style: S.link, href: login.qrcodeUrl, target: "_blank", rel: "noreferrer" }, "\u4E8C\u7EF4\u7801\u65E0\u6CD5\u663E\u793A\u65F6\u70B9\u51FB\u6B64\u94FE\u63A5")
      ) : null,
      login && login.phase === "scanned" ? import_react.default.createElement("div", { style: S.msg }, "\u5DF2\u626B\u7801\uFF0C\u6B63\u5728\u624B\u673A\u4E0A\u786E\u8BA4\u2026") : null,
      login && login.phase === "verify" ? import_react.default.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" } },
        import_react.default.createElement("div", { style: S.hint }, login.message || "\u8BF7\u8F93\u5165\u624B\u673A\u5FAE\u4FE1\u4E0A\u663E\u793A\u7684\u6570\u5B57"),
        import_react.default.createElement(
          "div",
          { style: S.row },
          import_react.default.createElement("input", { style: S.input, value: verifyCode, onChange: (e) => setVerifyCode(e.target.value), placeholder: "\u9A8C\u8BC1\u6570\u5B57", autoFocus: true }),
          import_react.default.createElement("button", { style: S.btnPrimary, disabled: busy || !verifyCode.trim(), onClick: () => act(() => apiSend("POST", API.wcVerify, { code: verifyCode.trim() }).then(() => setVerifyCode(""))) }, "\u63D0\u4EA4")
        )
      ) : null,
      login && login.phase === "error" ? import_react.default.createElement("div", { style: S.msg }, "\u26A0 " + (login.message || "\u767B\u5F55\u5931\u8D25")) : null,
      data && data.peers && data.peers.length > 0 ? import_react.default.createElement(
        "table",
        { style: S.table },
        import_react.default.createElement(
          "tbody",
          null,
          data.peers.map((p) => {
            const opts = (data.projects || []).map(
              (pr) => import_react.default.createElement("option", { key: pr.path, value: pr.path }, pr.title + (pr.remote ? "\uFF08\u8FDC\u7A0B\uFF09" : ""))
            );
            return import_react.default.createElement(
              "tr",
              { key: p.peerId },
              import_react.default.createElement("td", { style: { ...S.td, ...S.mono } }, p.peerId),
              import_react.default.createElement(
                "td",
                { style: S.td },
                import_react.default.createElement("select", {
                  style: S.select,
                  value: p.project,
                  onChange: (e) => act(() => apiSend("POST", API.wcSwitch, { peerId: p.peerId, project: e.target.value }), "\u5DF2\u5207\u6362")
                }, opts)
              )
            );
          })
        )
      ) : null,
      msg ? import_react.default.createElement("div", { style: S.msg }, msg) : null,
      import_react.default.createElement("div", { style: S.hint }, "\u5FAE\u4FE1 ClawBot \u63D2\u4EF6\u4E00\u6B21\u53EA\u80FD\u8FDE\u63A5\u4E00\u4E2A\u7AEF\u70B9\uFF08\u4E0E\u6574\u4E2A dsh web \u7ED1\u5B9A\uFF09\u3002\u98DE\u4E66\u901A\u9053\u6682\u672A\u63D0\u4F9B\uFF0C\u540E\u7EED\u53EF\u5728\u6B64\u5904\u6269\u5C55\u3002")
    )
  );
}
function GitNetCard(_props) {
  const [cfg, setCfg] = import_react.default.useState(null);
  const [token, setToken] = import_react.default.useState("");
  const [busy, setBusy] = import_react.default.useState(false);
  const [msg, setMsg] = import_react.default.useState("");
  const load = import_react.default.useCallback(async () => {
    try {
      const d = await apiGet(API.gitConfig);
      setCfg(d);
      setMsg("");
    } catch (e) {
      setMsg("\u52A0\u8F7D\u5931\u8D25\uFF1A" + String(e && e.message || e));
    }
  }, []);
  import_react.default.useEffect(() => {
    load();
  }, [load]);
  const saveGit = async (patch) => {
    setBusy(true);
    try {
      await apiSend("POST", API.gitConfig, { git: patch });
      await load();
    } catch (e) {
      setMsg("\u4FDD\u5B58\u5931\u8D25\uFF1A" + String(e && e.message || e));
    } finally {
      setBusy(false);
    }
  };
  const saveToken = async () => {
    setBusy(true);
    try {
      await apiSend("POST", API.gitConfig, { hfToken: token });
      setToken("");
      await load();
      setMsg("HF token \u5DF2\u4FDD\u5B58");
    } catch (e) {
      setMsg("\u4FDD\u5B58\u5931\u8D25\uFF1A" + String(e && e.message || e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (k) => (ev) => saveGit({ [k]: ev.target.checked });
  const proxy = cfg && cfg.proxy;
  const git = cfg && cfg.git || { pushApproval: false, restrictPaths: false };
  return import_react.default.createElement(
    "div",
    { style: S.card },
    import_react.default.createElement("div", { style: S.cardTitle }, "\u7F51\u7EDC\u4E0E Git\uFF08dwa_git / dwa_net_download\uFF09"),
    import_react.default.createElement(
      "div",
      { style: S.hint },
      "dwa_git \u5728 DSH \u8FDB\u7A0B\u5185\u76F4\u63A5\u6267\u884C git\uFF08\u4E0D\u53D7\u6C99\u7BB1 schannel/\u547D\u540D\u7BA1\u9053\u9650\u5236\uFF0C\u96F6\u5BA1\u6279\uFF09\uFF1Bdwa_net_download \u6D41\u5F0F\u4E0B\u8F7D GitHub/HuggingFace \u5927\u6587\u4EF6\uFF08\u76F4\u8FDE \u2192 \u4EE3\u7406 \u2192 hf-mirror \u56DE\u9000\uFF09\u3002"
    ),
    import_react.default.createElement(
      "div",
      { style: S.row },
      import_react.default.createElement(
        "div",
        { style: S.field },
        import_react.default.createElement("label", { style: S.label }, "\u4EE3\u7406\u72B6\u6001"),
        import_react.default.createElement("span", { style: S.mono }, proxy ? "\u5DF2\u53D1\u73B0\u5E76\u7F13\u5B58: " + proxy : "\u672A\u53D1\u73B0\uFF08\u76F4\u8FDE\u4F18\u5148\uFF0C\u5931\u8D25\u65F6\u81EA\u52A8\u626B\u63CF\u672C\u673A\u4EE3\u7406\uFF09")
      ),
      import_react.default.createElement(
        "div",
        { style: S.field },
        import_react.default.createElement("label", { style: S.label }, "git \u5BA1\u8BA1\u65E5\u5FD7"),
        import_react.default.createElement("span", { style: S.mono }, cfg && cfg.auditPath || "-")
      )
    ),
    import_react.default.createElement(
      "div",
      { style: S.row },
      import_react.default.createElement(
        "label",
        { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--dsw-alias-label-primary)" } },
        import_react.default.createElement("input", { type: "checkbox", checked: git.pushApproval, disabled: busy, onChange: toggle("pushApproval") }),
        "push \u9700\u5BA1\u6279\uFF08\u7ECF Web/\u5FAE\u4FE1\u6279\u51C6\u540E\u653E\u884C\uFF09"
      ),
      import_react.default.createElement(
        "label",
        { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--dsw-alias-label-primary)" } },
        import_react.default.createElement("input", { type: "checkbox", checked: git.restrictPaths, disabled: busy, onChange: toggle("restrictPaths") }),
        "\u8DEF\u5F84\u9650\u5236\uFF08git \u4E0E\u4E0B\u8F7D\u4EC5\u9650\u5DF2\u6CE8\u518C\u9879\u76EE\u76EE\u5F55\u5185\uFF09"
      )
    ),
    import_react.default.createElement(
      "div",
      { style: S.row },
      import_react.default.createElement(
        "div",
        { style: S.field },
        import_react.default.createElement("label", { style: S.label }, "HuggingFace token\uFF08\u79C1\u6709/\u53D7\u9650\u6A21\u578B\uFF0C\u53EF\u9009\uFF09"),
        import_react.default.createElement("input", { type: "password", style: S.input, value: token, disabled: busy, onChange: (ev) => setToken(ev.target.value), placeholder: cfg && cfg.hfTokenSet ? "\u5DF2\u8BBE\u7F6E\uFF08\u8F93\u5165\u65B0\u503C\u53EF\u8986\u76D6\uFF09" : "hf_..." })
      ),
      import_react.default.createElement("button", { style: S.btn, disabled: busy || !token, onClick: saveToken }, "\u4FDD\u5B58 token")
    ),
    msg ? import_react.default.createElement("div", { style: S.msg }, msg) : null
  );
}
function RemoteLabPage(_props) {
  const [hosts, setHosts] = import_react.default.useState([]);
  const [projects, setProjects] = import_react.default.useState([]);
  const [form, setForm] = import_react.default.useState({ path: "", alias: "", remoteRoot: "", sudoPassword: "" });
  const [busy, setBusy] = import_react.default.useState(false);
  const [message, setMessage] = import_react.default.useState("");
  const load = import_react.default.useCallback(async () => {
    try {
      const [h, p] = await Promise.all([apiGet(API.hosts), apiGet(API.projects)]);
      setHosts(h.hosts || []);
      setProjects(p.projects || []);
      setMessage("");
    } catch (e) {
      setMessage("\u52A0\u8F7D\u5931\u8D25\uFF1A" + String(e && e.message || e));
    }
  }, []);
  import_react.default.useEffect(() => {
    load();
  }, [load]);
  const set = (k) => (ev) => setForm((f) => ({ ...f, [k]: ev.target.value }));
  const pickProject = (path) => {
    const p = projects.find((x) => x.path === path);
    setForm((f) => ({
      ...f,
      path,
      alias: p && p.binding && p.binding.alias || f.alias,
      remoteRoot: p && p.binding && p.binding.remoteRoot || f.remoteRoot,
      sudoPassword: p && p.binding && p.binding.sudoPassword || f.sudoPassword
    }));
  };
  const submit = async () => {
    if (!form.path) {
      setMessage("\u8BF7\u9009\u62E9\u9879\u76EE");
      return;
    }
    if (!form.alias) {
      setMessage("\u8BF7\u9009\u62E9\u670D\u52A1\u5668");
      return;
    }
    setBusy(true);
    const project = projects.find((x) => x.path === form.path);
    const wasBound = !!(project && project.binding);
    try {
      await apiSend("POST", API.bindings, {
        path: form.path,
        alias: form.alias,
        remoteRoot: form.remoteRoot || void 0,
        sudoPassword: form.sudoPassword || void 0
      });
      await load();
      setMessage((wasBound ? "\u5DF2\u6362\u7ED1" : "\u5DF2\u7ED1\u5B9A") + "\uFF1A" + (project ? project.title : form.path) + " \u2192 " + form.alias);
    } catch (e) {
      setMessage("\u5931\u8D25\uFF1A" + String(e && e.message || e));
    } finally {
      setBusy(false);
    }
  };
  const unbind = async (p) => {
    if (!window.confirm("\u89E3\u9664\u300C" + p.title + "\u300D\u7684\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u7ED1\u5B9A\uFF1F\uFF08\u8FDC\u7AEF\u76EE\u5F55\u4E0E\u672C\u5730\u4EA7\u7269\u4E0D\u53D7\u5F71\u54CD\uFF09")) return;
    try {
      await apiSend("DELETE", API.bindings, { path: p.path });
      await load();
      setMessage("\u5DF2\u89E3\u7ED1\uFF1A" + p.title);
    } catch (e) {
      setMessage("\u89E3\u7ED1\u5931\u8D25\uFF1A" + String(e && e.message || e));
    }
  };
  return import_react.default.createElement(
    "div",
    { style: S.page },
    import_react.default.createElement(
      "div",
      { style: S.hint },
      "\u300C\u8FDC\u7A0B\u63A7\u5236\u300D= \u5FAE\u4FE1/\u98DE\u4E66\u9A71\u52A8 dsh + \u9879\u76EE\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u3002\u5BF9\u8BDD\u6807\u9898\u680F\u7684\u300C\u8FDC\u7A0B\u5B9E\u9A8C\u300D\u6309\u94AE\u53EF\u5FEB\u6377\u914D\u7F6E\u5F53\u524D\u9879\u76EE\u7ED1\u5B9A\uFF1B\u5FAE\u4FE1\u8FDE\u63A5\u4E0E\u6574\u4E2A dsh web \u7ED1\u5B9A\uFF08\u4E0D\u6309\u9879\u76EE/\u5BF9\u8BDD\uFF09\u3002"
    ),
    import_react.default.createElement(WechatControlCard, null),
    import_react.default.createElement(GitNetCard, null),
    import_react.default.createElement(
      "div",
      { style: S.card },
      import_react.default.createElement("div", { style: S.cardTitle }, "\u9879\u76EE\u7ED1\u5B9A / \u6362\u7ED1"),
      import_react.default.createElement(
        "div",
        { style: S.row },
        import_react.default.createElement(
          "div",
          { style: S.field },
          import_react.default.createElement("label", { style: S.label }, "\u9879\u76EE"),
          projects.length === 0 ? import_react.default.createElement("div", { style: S.hint }, "\u6682\u65E0\u9879\u76EE\uFF08DSH \u5DE5\u4F5C\u533A\uFF09") : import_react.default.createElement(
            "select",
            { style: S.input, value: form.path, onChange: (ev) => pickProject(ev.target.value) },
            import_react.default.createElement("option", { value: "", disabled: true }, "\u9009\u62E9\u9879\u76EE"),
            projects.map((p) => import_react.default.createElement(
              "option",
              { key: p.id, value: p.path },
              p.title + (p.binding ? "\uFF08\u5F53\u524D: " + p.binding.alias + "\uFF09" : "\uFF08\u672A\u7ED1\u5B9A\uFF09")
            ))
          )
        ),
        import_react.default.createElement(
          "div",
          { style: S.field },
          import_react.default.createElement("label", { style: S.label }, "\u670D\u52A1\u5668"),
          hosts.length === 0 ? import_react.default.createElement("div", { style: S.hint }, "\u8BF7\u5148\u5230\u4FA7\u8FB9\u680F\u300CSSH\u300D\u9762\u677F\u6DFB\u52A0\u4E3B\u673A") : import_react.default.createElement(
            "select",
            { style: S.input, value: form.alias, onChange: set("alias") },
            import_react.default.createElement("option", { value: "", disabled: true }, "\u9009\u62E9\u4E3B\u673A"),
            hosts.map((h) => import_react.default.createElement("option", { key: h.alias, value: h.alias }, h.alias + "\uFF08" + h.user + "@" + h.host + ":" + h.port + "\uFF09"))
          )
        ),
        import_react.default.createElement(
          "div",
          { style: S.field },
          import_react.default.createElement("label", { style: S.label }, "\u8FDC\u7AEF\u6839\u76EE\u5F55\uFF08\u53EF\u9009\uFF09"),
          import_react.default.createElement("input", { style: S.input, value: form.remoteRoot, onChange: set("remoteRoot"), placeholder: "\u9ED8\u8BA4 ~/remote-lab/<\u9879\u76EE\u540D>" })
        )
      ),
      import_react.default.createElement(
        "div",
        { style: S.row },
        import_react.default.createElement(
          "div",
          { style: S.field },
          import_react.default.createElement("label", { style: S.label }, "sudo \u5BC6\u7801\uFF08\u53EF\u9009\uFF09"),
          import_react.default.createElement("input", { type: "password", style: S.input, value: form.sudoPassword, onChange: set("sudoPassword"), placeholder: "\u76EE\u6807\u76EE\u5F55\u9700 root \u6743\u9650\u65F6\u5FC5\u586B" })
        ),
        import_react.default.createElement("button", { style: S.btnPrimary, onClick: submit, disabled: busy || hosts.length === 0 || projects.length === 0 }, busy ? "\u5904\u7406\u4E2D\u2026" : "\u7ED1\u5B9A / \u6362\u7ED1")
      )
    ),
    import_react.default.createElement(
      "div",
      { style: S.card },
      import_react.default.createElement(
        "div",
        { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
        import_react.default.createElement("div", { style: S.cardTitle }, "\u9879\u76EE\u4E0E\u7ED1\u5B9A"),
        import_react.default.createElement("button", { style: S.btn, onClick: load }, "\u5237\u65B0")
      ),
      projects.length === 0 ? import_react.default.createElement("div", { style: S.empty }, "\u6682\u65E0\u9879\u76EE\uFF08DSH \u5DE5\u4F5C\u533A\uFF09\u3002") : import_react.default.createElement(
        "table",
        { style: S.table },
        import_react.default.createElement(
          "tbody",
          null,
          projects.map((p) => import_react.default.createElement(
            "tr",
            { key: p.id },
            import_react.default.createElement("td", { style: S.td }, p.title),
            import_react.default.createElement("td", { style: { ...S.td, ...S.mono } }, p.path),
            import_react.default.createElement(
              "td",
              { style: S.td },
              p.binding ? import_react.default.createElement("span", { style: S.tagOk }, p.binding.alias + " \u2192 " + p.binding.remoteRoot) : import_react.default.createElement("span", { style: S.tag }, "\u672A\u7ED1\u5B9A")
            ),
            import_react.default.createElement("td", { style: S.td }, planText(p.plan)),
            import_react.default.createElement(
              "td",
              { style: S.td },
              import_react.default.createElement("button", { style: S.btn, onClick: () => pickProject(p.path) }, "\u6362\u7ED1"),
              " ",
              p.binding ? import_react.default.createElement("button", { style: S.btn, onClick: () => unbind(p) }, "\u89E3\u7ED1") : null
            )
          ))
        )
      )
    ),
    message ? import_react.default.createElement("div", { style: S.msg }, message) : null
  );
}
function apply(ctx) {
  const slots = ctx.get("slots");
  if (slots === void 0) return;
  ctx.effect(() => {
    const disposers = [];
    try {
      const unsubSettings = slots.inject("settings.section", () => {
        const unreg = slots.register(
          { name: "settings.section", id: "remote-lab", order: 160, label: "\u8FDC\u7A0B\u63A7\u5236" },
          (props) => import_react.default.createElement(RemoteLabPage, props)
        );
        if (typeof unreg === "function") disposers.push(unreg);
      });
      if (typeof unsubSettings === "function") disposers.push(unsubSettings);
    } catch (e) {
      console.warn("[remote-lab] settings mount failed:", e);
    }
    try {
      const unsubHeader = slots.inject("conversation.session.header.actions", () => {
        const unreg = slots.register(
          { name: "conversation.session.header.actions", id: "remote-lab", order: 30, label: "\u8FDC\u7A0B\u5B9E\u9A8C" },
          (props) => import_react.default.createElement(HeaderBindButton, props)
        );
        if (typeof unreg === "function") disposers.push(unreg);
      });
      if (typeof unsubHeader === "function") disposers.push(unsubHeader);
    } catch (e) {
      console.warn("[remote-lab] header action mount failed:", e);
    }
    return () => {
      for (const d of disposers) {
        try {
          d();
        } catch {
        }
      }
    };
  });
}

		return module.exports;
	}
});
