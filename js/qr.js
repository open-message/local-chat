import qrcode from "./vendor/qrcode-generator.js";

export function qrSvg(text, { alt = "QR code" } = {}) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
  const qr = qrcode(0, "M");
  qr.addData(String(text), "Byte");
  qr.make();
  return qr.createSvgTag({
    cellSize: 4,
    margin: 8,
    scalable: true,
    alt,
  });
}
