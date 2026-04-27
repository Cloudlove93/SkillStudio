declare module 'adm-zip' {
  interface IZipEntry {
    entryName: string;
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
