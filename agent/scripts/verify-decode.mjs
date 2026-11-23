import iconv from "iconv-lite";
import { decodeProcessOutput } from "../dist/runners/decodeOutput.js";

const sample = "\u56de\u590d\u5b58\u5728\u4e71\u7801\uff0c\u89e3\u51b3\u4e0b";
const utf8 = Buffer.from(sample, "utf8");
const gbk = iconv.encode(sample, "gbk");

const decodedUtf8 = decodeProcessOutput(utf8, "auto");
const decodedGbk = decodeProcessOutput(gbk, "auto");
const forcedGbk = decodeProcessOutput(gbk, "gbk");

const okUtf8 = decodedUtf8 === sample;
const okGbkAuto = decodedGbk === sample;
const okGbkForced = forcedGbk === sample;

console.log(
  JSON.stringify(
    {
      okUtf8,
      okGbkAuto,
      okGbkForced,
      decodedUtf8,
      decodedGbk,
      forcedGbk,
    },
    null,
    2,
  ),
);

if (!okUtf8 || !okGbkForced) {
  process.exit(1);
}
