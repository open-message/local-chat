declare function qrcode(
  typeNumber: number,
  errorCorrectionLevel: string,
): {
  addData: (data: string, mode: string) => void;
  make: () => void;
  createSvgTag: (opts?: {
    cellSize?: number;
    margin?: number;
    scalable?: boolean;
    alt?: string;
  }) => string;
  createDataURL: (cellSize?: number, margin?: number) => string;
};

declare namespace qrcode {
  let stringToBytes: (s: string) => number[];
  const stringToBytesFuncs: Record<string, (s: string) => number[]>;
}

export default qrcode;
