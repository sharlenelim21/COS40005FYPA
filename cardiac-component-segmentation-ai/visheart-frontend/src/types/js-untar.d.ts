declare module 'js-untar' {
  interface UntarFile {
    name: string;
    buffer: ArrayBuffer;
  }
  
  export function untar(buffer: ArrayBuffer): Promise<UntarFile[]>;
  export default function untar(buffer: ArrayBuffer): Promise<UntarFile[]>;
}
