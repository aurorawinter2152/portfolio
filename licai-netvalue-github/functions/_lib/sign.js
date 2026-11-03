// 招银理财公开 API 签名与请求头构造。
// signature = Base64( SM4-ECB-PKCS7Pad( key, appId + "|" + timestampMs ) )
// 签名只覆盖 appId|时间戳，不覆盖请求体与路径。

import { sm4EcbEncrypt, bytesToBase64 } from "./sm4.js";

export const APP_ID = "LB50.22_CFWebUI";
export const SM4_KEY = "9qwBGju73JAXid48"; // 16 个 ASCII 字符 = 16 字节
export const UPSTREAM_BASE = "https://cfweb.paas.cmbchina.com";
export const BUSINESS_ID = "probe-0001";

function strToU8(str){
  return new TextEncoder().encode(str);
}

export function buildSignature(timestampMs){
  const plaintext = strToU8(APP_ID + "|" + timestampMs);
  const key = strToU8(SM4_KEY);
  const cipher = sm4EcbEncrypt(plaintext, key);
  return bytesToBase64(cipher);
}

export function buildAuthHeaders(){
  const ts = Date.now();
  return {
    "appId": APP_ID,
    "timespan": String(ts),
    "signature": buildSignature(ts),
    "X-B3-BusinessId": BUSINESS_ID,
    "Content-Type": "application/json;charset=UTF-8"
  };
}
