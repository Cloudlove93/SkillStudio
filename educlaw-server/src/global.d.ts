declare module 'adm-zip' {
  interface IZipEntryHeader {
    size: number;
    compressedSize: number;
    encrypted?: boolean;
  }

  interface IZipEntry {
    entryName: string;
    isDirectory: boolean;
    header: IZipEntryHeader;
    getData(): Buffer;
  }
  class AdmZip {
    constructor(buffer?: Buffer);
    getEntries(): IZipEntry[];
    readAsText(entry: IZipEntry, encoding?: string): string;
    addFile(entryName: string, content: Buffer): void;
    toBuffer(): Buffer;
  }
  export = AdmZip;
  export { IZipEntry };
}
