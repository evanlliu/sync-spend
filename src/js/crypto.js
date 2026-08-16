const IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7
];

const FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25
];

const E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13,
  12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21, 22, 23,
  24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1
];

const P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25
];

const PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4
];

const PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32
];

const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

const SBOXES = [
  [
    [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7],
    [0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8],
    [4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0],
    [15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13]
  ],
  [
    [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10],
    [3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5],
    [0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15],
    [13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9]
  ],
  [
    [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8],
    [13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1],
    [13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7],
    [1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12]
  ],
  [
    [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15],
    [13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9],
    [10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4],
    [3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14]
  ],
  [
    [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9],
    [14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6],
    [4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14],
    [11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3]
  ],
  [
    [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11],
    [10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8],
    [9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6],
    [4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13]
  ],
  [
    [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1],
    [13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6],
    [1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2],
    [6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12]
  ],
  [
    [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7],
    [1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2],
    [7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8],
    [2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11]
  ]
];

export function decryptDotNetDesBase64(ciphertext, keyText, ivText = keyText) {
  const cipherBytes = decodeBase64(ciphertext);
  const keyBytes = utf16LeBytes(keyText);
  const ivBytes = utf16LeBytes(ivText);

  if (keyBytes.length !== 8) throw new Error("DES key 使用 UTF-16LE 后必须正好为 8 字节（通常 4 个 ASCII 字符）");
  if (ivBytes.length !== 8) throw new Error("DES IV 使用 UTF-16LE 后必须正好为 8 字节（通常 4 个 ASCII 字符）");
  if (!cipherBytes.length || cipherBytes.length % 8 !== 0) throw new Error("DES Base64 密文长度无效");

  const subKeys = createSubKeys(bytesToBigInt(keyBytes));
  let previous = bytesToBigInt(ivBytes);
  const plainBytes = new Uint8Array(cipherBytes.length);

  for (let offset = 0; offset < cipherBytes.length; offset += 8) {
    const cipherBlock = bytesToBigInt(cipherBytes.subarray(offset, offset + 8));
    const decryptedBlock = desBlock(cipherBlock, subKeys, true) ^ previous;
    plainBytes.set(bigIntToBytes(decryptedBlock, 8), offset);
    previous = cipherBlock;
  }

  const unpadded = removePkcs7Padding(plainBytes, 8);
  return decodeUtf16Le(unpadded);
}

function createSubKeys(key64) {
  const key56 = permute(key64, PC1, 64);
  let left = Number((key56 >> 28n) & 0x0fffffffn);
  let right = Number(key56 & 0x0fffffffn);
  const keys = [];

  for (const shift of SHIFTS) {
    left = rotate28(left, shift);
    right = rotate28(right, shift);
    const combined = (BigInt(left) << 28n) | BigInt(right);
    keys.push(permute(combined, PC2, 56));
  }
  return keys;
}

function rotate28(value, shift) {
  const mask = 0x0fffffff;
  return (((value << shift) & mask) | (value >>> (28 - shift))) >>> 0;
}

function desBlock(block64, subKeys, decrypt) {
  const initial = permute(block64, IP, 64);
  let left = Number((initial >> 32n) & 0xffffffffn) >>> 0;
  let right = Number(initial & 0xffffffffn) >>> 0;
  const keys = decrypt ? [...subKeys].reverse() : subKeys;

  for (const key of keys) {
    const nextLeft = right;
    const nextRight = (left ^ feistel(right, key)) >>> 0;
    left = nextLeft;
    right = nextRight;
  }

  const preOutput = (BigInt(right) << 32n) | BigInt(left);
  return permute(preOutput, FP, 64);
}

function feistel(right32, subKey) {
  const expanded = permute(BigInt(right32 >>> 0), E, 32) ^ subKey;
  let sboxOutput = 0n;

  for (let index = 0; index < 8; index += 1) {
    const shift = BigInt((7 - index) * 6);
    const sixBits = Number((expanded >> shift) & 0x3fn);
    const row = ((sixBits & 0x20) >> 4) | (sixBits & 0x01);
    const column = (sixBits >> 1) & 0x0f;
    sboxOutput = (sboxOutput << 4n) | BigInt(SBOXES[index][row][column]);
  }

  return Number(permute(sboxOutput, P, 32) & 0xffffffffn) >>> 0;
}

function permute(value, table, inputBits) {
  let result = 0n;
  for (const position of table) {
    const bit = (value >> BigInt(inputBits - position)) & 1n;
    result = (result << 1n) | bit;
  }
  return result;
}

function bytesToBigInt(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bigIntToBytes(value, length) {
  const bytes = new Uint8Array(length);
  let current = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(current & 0xffn);
    current >>= 8n;
  }
  return bytes;
}

function utf16LeBytes(value) {
  const text = String(value ?? "");
  const bytes = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    bytes[index * 2] = codeUnit & 0xff;
    bytes[index * 2 + 1] = codeUnit >>> 8;
  }
  return bytes;
}

function decodeUtf16Le(bytes) {
  if (bytes.length % 2 !== 0) throw new Error("DES 解密结果不是有效 UTF-16LE 文本");
  let result = "";
  const chunk = [];
  for (let index = 0; index < bytes.length; index += 2) {
    chunk.push(bytes[index] | (bytes[index + 1] << 8));
    if (chunk.length >= 0x4000) {
      result += String.fromCharCode(...chunk);
      chunk.length = 0;
    }
  }
  if (chunk.length) result += String.fromCharCode(...chunk);
  return result;
}

function removePkcs7Padding(bytes, blockSize) {
  const padding = bytes[bytes.length - 1];
  if (padding < 1 || padding > blockSize || padding > bytes.length) {
    throw new Error("DES PKCS7 padding 无效，密钥/IV 或密文可能不正确");
  }
  for (let index = bytes.length - padding; index < bytes.length; index += 1) {
    if (bytes[index] !== padding) throw new Error("DES PKCS7 padding 无效，密钥/IV 或密文可能不正确");
  }
  return bytes.subarray(0, bytes.length - padding);
}

function decodeBase64(value) {
  const clean = String(value || "").replace(/\s+/g, "");
  if (!clean || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error("Token Base64 密文格式无效");
  }

  if (typeof atob === "function") {
    let binary;
    try {
      binary = atob(clean);
    } catch {
      throw new Error("Token Base64 密文无法解码");
    }
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(clean, "base64"));
  }

  throw new Error("当前运行环境不支持 Base64 解码");
}
